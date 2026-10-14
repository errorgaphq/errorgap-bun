import type { Configuration } from "./configuration.js";
import { RemoteSettings, type RemoteKind } from "./remote-settings.js";
import { buildNotice, type NoticeContext, type NoticePayload } from "./notice.js";
import { transactionPayload, type Transaction } from "./apm.js";
import { logLevelRank, normalizeLogLevel } from "./logs.js";
import { VERSION } from "./version.js";
import { currentTransactionId } from "./transaction-context.js";

import { Delivery, type DeliveryResult } from "./delivery.js";

export type { DeliveryResult } from "./delivery.js";

export interface LogOptions {
  source?: string;
  environment?: string;
  occurredAt?: string;
  sync?: boolean;
}

/** Which of the project's switches covers each kind of payload. */
const REMOTE_KINDS: Record<string, RemoteKind | undefined> = {
  notices: "errors",
  transactions: "apm",
  logs: "logs",
};

export class Client {
  /** What errorgap wants this app to send (the project's remote settings). */
  readonly remote = new RemoteSettings(() => this.configuration);
  private delivery = new Delivery(() => ({
    endpoint: this.configuration.endpoint,
    projectSlug: this.configuration.projectSlug,
    apiKey: this.configuration.apiKey,
    timeout: this.configuration.timeout,
    queueSize: this.configuration.queueSize,
    userAgent: `errorgap-bun/${VERSION}`,
    warn: (message) => this.configuration.logger?.warn(message),
  }));

  constructor(private configuration: Configuration) {}

  configure(configuration: Configuration): void {
    this.configuration = configuration;
  }

  async notify(
    error: unknown,
    options: NoticeContext & { sync?: boolean } = {},
  ): Promise<DeliveryResult> {
    try {
      this.configuration.validate();
      const err = coerceError(error);
      const notice = await this.runHook(
        buildNotice(err, this.configuration, withTransaction(options)),
      );
      if (!notice) return { status: 202, body: "dropped by beforeNotify" };
      return this.submit("notices", notice, options.sync);
    } catch (exception) {
      this.log(exception);
      return { error: exception };
    }
  }

  /** Deliver an APM transaction (HTTP interaction or background job). */
  async notifyTransaction(
    transaction: Transaction,
    options: { sync?: boolean } = {},
  ): Promise<DeliveryResult> {
    try {
      this.configuration.validate();
    } catch (exception) {
      this.log(exception);
      return { error: exception };
    }
    if (!this.configuration.apmEnabled) {
      return { status: 204 };
    }
    const rate = this.configuration.apmSampleRate;
    if (!(rate >= 1 || (rate > 0 && Math.random() < rate))) {
      return { status: 204 };
    }
    return this.submit("transactions", transactionPayload(transaction, this.configuration), options.sync);
  }

  /** Deliver a structured log line. */
  async notifyLog(
    message: string,
    level = "info",
    options: LogOptions = {},
  ): Promise<DeliveryResult> {
    try {
      this.configuration.validate();
    } catch (exception) {
      this.log(exception);
      return { error: exception };
    }
    const normalizedLevel = normalizeLogLevel(level);
    if (
      !this.configuration.logsEnabled ||
      logLevelRank(normalizedLevel) <
        logLevelRank(normalizeLogLevel(this.configuration.minimumLogLevel))
    ) {
      return { status: 204 };
    }
    const payload: Record<string, unknown> = {
      message,
      level: normalizedLevel,
      environment: options.environment ?? this.configuration.environment,
      occurred_at: options.occurredAt ?? new Date().toISOString(),
    };
    if (options.source) payload.source = options.source;
    return this.submit("logs", payload, options.sync);
  }

  private async submit(
    resource: string,
    payload: unknown,
    sync?: boolean,
  ): Promise<DeliveryResult> {
    if (this.configuration.ignoredEnvironment()) return { status: 204 };
    const kind = REMOTE_KINDS[resource];
    if (kind && !this.remote.enabled(kind)) return { status: 204 };
    if (sync || !this.configuration.async) return await this.delivery.send(resource, payload);
    return this.delivery.enqueue(resource, payload);
  }

  deliver(resource: string, payload: unknown): Promise<DeliveryResult> {
    return this.delivery.send(resource, payload);
  }

  /** Await everything queued or being sent. Use during graceful shutdown. */
  async flush(): Promise<void> {
    await this.delivery.flush();
  }

  /**
   * A hook that throws is logged and skipped: a bug in a filter must not
   * lose the error it was filtering.
   */
  private async runHook(notice: NoticePayload): Promise<NoticePayload | null> {
    const hook = this.configuration.beforeNotify;
    if (!hook) return notice;
    try {
      const result = await hook(notice);
      if (result === false || result === null) return null;
      return result && typeof result === "object" && Array.isArray(result.errors) ? result : notice;
    } catch (exception) {
      this.log(exception);
      return notice;
    }
  }

  private log(exception: unknown): void {
    const logger = this.configuration.logger;
    if (!logger) return;
    const message =
      exception instanceof Error
        ? `${exception.name}: ${exception.message}`
        : String(exception);
    logger.warn(`[errorgap] ${message}`);
  }
}

function coerceError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (error && typeof error === "object") {
    const obj = error as { message?: unknown; name?: unknown };
    const err = new Error(
      typeof obj.message === "string" ? obj.message : JSON.stringify(error),
    );
    if (typeof obj.name === "string") err.name = obj.name;
    return err;
  }
  return new Error(String(error));
}

/**
 * The request or job this error was raised in, unless the caller set one,
 * so errorgap links the two.
 */
function withTransaction<T extends NoticeContext>(options: T): T {
  const id = currentTransactionId();
  if (!id || (options.context && "transaction_id" in options.context)) return options;
  return { ...options, context: { ...(options.context ?? {}), transaction_id: id } };
}
