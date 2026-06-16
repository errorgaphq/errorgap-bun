import type { Configuration } from "./configuration.js";
import { parseBacktrace, type BacktraceFrame } from "./backtrace.js";
import { filterParams } from "./filter.js";
import { VERSION } from "./version.js";

export interface NoticeContext {
  context?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  session?: Record<string, unknown>;
  params?: Record<string, unknown>;
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
  return {
    project_id: configuration.projectId,
    received_at: new Date().toISOString(),
    errors: [
      {
        type: errorType(error),
        message: String(error.message ?? ""),
        backtrace: parseBacktrace(error),
      },
    ],
    context: {
      notifier: "errorgap-bun",
      notifier_version: VERSION,
      environment: configuration.environment,
      release: configuration.release,
      runtime: "bun",
      runtime_version: tryBunVersion(),
      ...(options.context ?? {}),
    },
    environment: options.environment ?? {},
    session: options.session ?? {},
    params: filterParams(options.params ?? {}, configuration.filterKeys),
  };
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
