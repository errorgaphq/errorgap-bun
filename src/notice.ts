import type { Configuration } from "./configuration.js";
import { parseBacktrace, type BacktraceFrame } from "./backtrace.js";
import type { Breadcrumb } from "./breadcrumbs.js";
import { filterParams } from "./filter.js";
import { VERSION } from "./version.js";

const MAX_CAUSE_DEPTH = 10;

export interface NoticeContext {
  context?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  session?: Record<string, unknown>;
  params?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
}

export interface NoticeCause {
  type: string;
  message: string;
}

export interface NoticePayload {
  project_id?: string;
  received_at: string;
  errors: Array<{
    type: string;
    message: string;
    backtrace: BacktraceFrame[];
  }>;
  context: Record<string, unknown>;
  environment: Record<string, unknown>;
  session: Record<string, unknown>;
  params: Record<string, unknown>;
}

export function buildNotice(
  error: Error,
  configuration: Configuration,
  options: NoticeContext = {},
): NoticePayload {
  const causes = collectCauses(error);
  const breadcrumbs = options.breadcrumbs ?? [];

  return {
    project_id: configuration.projectId,
    received_at: new Date().toISOString(),
    errors: [
      {
        type: errorType(error),
        message: String(error.message ?? ""),
        backtrace: flattenBacktrace(error, configuration.rootDirectory),
      },
    ],
    context: {
      notifier: "errorgap-bun",
      notifier_version: VERSION,
      environment: configuration.environment,
      release: configuration.release,
      runtime: "bun",
      runtime_version: tryBunVersion(),
      ...(causes.length > 0 ? { causes } : {}),
      ...(breadcrumbs.length > 0 ? { breadcrumbs } : {}),
      ...(options.context ?? {}),
    },
    environment: options.environment ?? {},
    session: options.session ?? {},
    params: filterParams(options.params ?? {}, configuration.filterKeys),
  };
}

/**
 * Walk `error.cause` (ES2022) and merge each cause's frames into a single
 * backtrace, re-indexing so the dashboard renders the full chain in one view.
 */
function flattenBacktrace(error: Error, rootDirectory: string): BacktraceFrame[] {
  const frames: BacktraceFrame[] = [];
  let index = 0;
  for (const link of errorChain(error)) {
    for (const frame of parseBacktrace(link, rootDirectory)) {
      frames.push({ ...frame, index: index++ });
    }
  }
  return frames;
}

function collectCauses(error: Error): NoticeCause[] {
  return errorChain(error)
    .slice(1)
    .map((link) => ({ type: errorType(link), message: String(link.message ?? "") }));
}

function errorChain(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current) && chain.length < MAX_CAUSE_DEPTH) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function tryBunVersion(): string | undefined {
  try {
    // @ts-ignore — Bun global is defined when running under Bun.
    return typeof Bun !== "undefined" ? Bun.version : undefined;
  } catch {
    return undefined;
  }
}

function errorType(error: Error): string {
  if (typeof error.name === "string" && error.name.length > 0) {
    return error.name;
  }
  return error.constructor?.name ?? "Error";
}
