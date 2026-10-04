import { Client, type DeliveryResult, type LogOptions } from "./client.js";
import { Configuration, type ConfigurationInput } from "./configuration.js";
import { installProcessHandlers, uninstallProcessHandlers } from "./handlers.js";
import { BreadcrumbBuffer, type BreadcrumbInput } from "./breadcrumbs.js";
import {
  browserTraceId,
  routeName,
  SpanCollector,
  TRACE_HEADER,
  type Transaction,
} from "./apm.js";
import type { NoticeContext } from "./notice.js";
import { VERSION } from "./version.js";
import { currentTransactionId, newTransactionId, runInTransaction } from "./transaction-context.js";

export type { ConfigurationInput, Logger } from "./configuration.js";
export type { BacktraceFrame, SourceExcerpt } from "./backtrace.js";
export type { NoticeContext, NoticePayload, NoticeCause } from "./notice.js";
export type { DeliveryResult, LogOptions } from "./client.js";
export type { Breadcrumb, BreadcrumbInput } from "./breadcrumbs.js";
export type { Span, SpanLocation, Transaction } from "./apm.js";
export { Client } from "./client.js";
export { Configuration } from "./configuration.js";
export {
  SpanCollector,
  databaseSpan,
  externalSpan,
  normalizeSql,
  browserTraceId,
  routeName,
  TRACE_HEADER,
} from "./apm.js";
export { BreadcrumbBuffer } from "./breadcrumbs.js";
export { currentTransactionId, newTransactionId, runInTransaction } from "./transaction-context.js";
export { VERSION };

let configuration = new Configuration();
let client = new Client(configuration);
let breadcrumbs = new BreadcrumbBuffer(configuration.maxBreadcrumbs);

export interface InitOptions extends ConfigurationInput {
  /** Install process.uncaughtException / unhandledRejection handlers. */
  captureGlobals?: boolean;
}

function init(options: InitOptions = {}): void {
  const { captureGlobals = true, ...rest } = options;
  configuration = new Configuration(rest);
  client.configure(configuration);
  breadcrumbs = new BreadcrumbBuffer(configuration.maxBreadcrumbs);
  if (captureGlobals) {
    installProcessHandlers(client, breadcrumbs);
  } else {
    uninstallProcessHandlers();
  }
}

function notify(
  error: unknown,
  options: NoticeContext & { sync?: boolean } = {},
): Promise<DeliveryResult> {
  return client.notify(error, { breadcrumbs: breadcrumbs.snapshot(), ...options });
}

/** Record a diagnostic breadcrumb attached to subsequent notices. */
function addBreadcrumb(message: string, input: BreadcrumbInput = {}): void {
  breadcrumbs.add(message, input);
}

function clearBreadcrumbs(): void {
  breadcrumbs.clear();
}

/** Deliver a structured log line at the given level. */
function log(message: string, level = "info", options: LogOptions = {}): Promise<DeliveryResult> {
  return client.notifyLog(message, level, options);
}

/** Deliver an APM transaction (HTTP interaction or background job). */
function notifyTransaction(
  transaction: Transaction,
  options: { sync?: boolean } = {},
): Promise<DeliveryResult> {
  return client.notifyTransaction(transaction, options);
}

/**
 * Time an HTTP interaction and deliver it as a transaction. The callback
 * receives a `SpanCollector` for recording DB/HTTP spans.
 */
async function trackTransaction<T>(
  meta: Omit<Transaction, "durationMs" | "spans" | "kind"> & { kind?: string },
  operation: (spans: SpanCollector) => Promise<T> | T,
): Promise<T> {
  const spans = new SpanCollector();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  // Errors reported while the operation runs carry this transaction's id.
  const id = meta.id ?? newTransactionId();
  try {
    return await runInTransaction(id, () => operation(spans));
  } finally {
    void notifyTransaction({
      kind: meta.kind ?? "web",
      ...meta,
      id,
      occurredAt: meta.occurredAt ?? startedAt,
      durationMs: Date.now() - start,
      spans: spans.snapshot(),
    });
  }
}

/**
 * Time a background job and deliver it as a `job` transaction. The callback
 * receives a `SpanCollector` for recording DB/HTTP spans.
 */
async function trackJob<T>(
  jobClass: string,
  operation: (spans: SpanCollector) => Promise<T> | T,
  meta: { queue?: string; environment?: string } = {},
): Promise<T> {
  const spans = new SpanCollector();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const id = newTransactionId();
  try {
    return await runInTransaction(id, () => operation(spans));
  } finally {
    void notifyTransaction({
      id,
      kind: "job",
      jobClass,
      queue: meta.queue ?? "default",
      environment: meta.environment,
      occurredAt: startedAt,
      durationMs: Date.now() - start,
      spans: spans.snapshot(),
    });
  }
}

/** Options for {@link withErrorgap}. */
export interface ServeTrackingOptions {
  /**
   * The route a request is grouped by. Defaults to the path with id-like
   * segments replaced by `:id` (see `routeName`).
   */
  route?: (request: Request) => string | undefined;
  /** Report errors the handler throws. Defaults to true. */
  reportErrors?: boolean;
}

/**
 * Wrap a `Bun.serve` fetch handler so each request is an APM transaction
 * (sent with `apmEnabled`). Errors reported while it runs carry the
 * transaction id, an error it throws is reported (and rethrown), and the
 * browser SDK's `x-errorgap-trace` header links the browser's view of the
 * call to it. Works for any `(request) => Response` handler, e.g. Hono's
 * `app.fetch`.
 */
export function withErrorgap<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: ServeTrackingOptions = {},
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request: Request, ...rest: A): Promise<Response> => {
    const id = newTransactionId();
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const pathname = new URL(request.url).pathname;
    let status = 500;
    try {
      const response = await runInTransaction(id, () => handler(request, ...rest));
      status = response.status;
      return response;
    } catch (error) {
      if (options.reportErrors !== false) {
        await notify(error, {
          context: { transaction_id: id, url: request.url.split("?")[0], action: request.method },
          environment: { method: request.method, path: pathname },
          sync: true,
        });
      }
      throw error;
    } finally {
      void notifyTransaction({
        id,
        traceId: browserTraceId(request.headers.get(TRACE_HEADER)),
        kind: "web",
        method: request.method,
        path: options.route?.(request) ?? routeName(pathname),
        pathRaw: pathname,
        statusCode: status,
        durationMs: performance.now() - start,
        occurredAt: startedAt,
      });
    }
  };
}

function flush(): Promise<void> {
  return client.flush();
}

function getConfiguration(): Configuration {
  return configuration;
}

function getClient(): Client {
  return client;
}

export const Errorgap = {
  init,
  currentTransactionId,
  runInTransaction,
  notify,
  addBreadcrumb,
  clearBreadcrumbs,
  log,
  notifyTransaction,
  trackTransaction,
  trackJob,
  withErrorgap,
  flush,
  configuration: getConfiguration,
  client: getClient,
  VERSION,
};

export {
  init,
  notify,
  addBreadcrumb,
  clearBreadcrumbs,
  log,
  notifyTransaction,
  trackTransaction,
  trackJob,
  flush,
};
