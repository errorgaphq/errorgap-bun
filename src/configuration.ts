export interface Logger {
  warn(message: string, ...args: unknown[]): void;
}

import type { FilterKey } from "./filter.js";
import { detectRelease } from "./release.js";
import type { NoticePayload } from "./notice.js";

/**
 * Sees each notice before it is sent. Change it in place or return a
 * replacement; return `false` or `null` to drop it.
 */
export type BeforeNotify = (
  notice: NoticePayload,
) => NoticePayload | false | null | void | Promise<NoticePayload | false | null | void>;

export interface ConfigurationInput {
  endpoint?: string;
  projectSlug?: string;
  projectId?: string;
  apiKey?: string;
  environment?: string;
  release?: string;
  async?: boolean;
  logger?: Logger | null;
  /** Substrings (case-insensitive) or regexps; matching keys are masked at any depth. */
  filterKeys?: FilterKey[];
  beforeNotify?: BeforeNotify;
  /**
   * Follow the project's settings in errorgap (Project settings › What SDKs
   * send): stop sending what is switched off there. Defaults to true.
   */
  remoteSettings?: boolean;
  /** Environments in which nothing is sent. */
  ignoreEnvironments?: string[];
  /** Seconds allowed for each request to errorgap. Default 5. */
  timeout?: number;
  /** Payloads held for sending; the oldest is dropped when full. Default 100. */
  queueSize?: number;
  /** Root directory used to relativize backtrace source paths. Default cwd. */
  rootDirectory?: string;
  /** Enable APM transaction delivery. Default true. */
  apmEnabled?: boolean;
  /** Fraction (0..1) of transactions to deliver. Default 1. */
  apmSampleRate?: number;
  /** Enable structured log delivery. Default true. */
  logsEnabled?: boolean;
  /** Drop logs below this level (trace<debug<info<warn<error<fatal). Default "info". */
  minimumLogLevel?: string;
  /** Number of breadcrumbs retained and attached to notices. Default 25. */
  maxBreadcrumbs?: number;
}

const IGNORE_ENV_DEFAULT = (process.env.ERRORGAP_IGNORE_ENVIRONMENTS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const REMOTE_SETTINGS_DEFAULT =
  (process.env.ERRORGAP_REMOTE_SETTINGS ?? "").trim().toLowerCase() !== "false";

const DEFAULT_FILTER_KEYS = [
  "password",
  "password_confirmation",
  "token",
  "secret",
  "api_key",
  "authorization",
  "cookie",
];

export class Configuration {
  endpoint: string;
  projectSlug: string | undefined;
  projectId: string | undefined;
  apiKey: string | undefined;
  environment: string;
  release: string | undefined;
  async: boolean;
  logger: Logger | null;
  filterKeys: FilterKey[];
  beforeNotify: BeforeNotify | undefined;
  remoteSettings: boolean;
  ignoreEnvironments: string[];
  timeout: number;
  queueSize: number;
  rootDirectory: string;
  apmEnabled: boolean;
  apmSampleRate: number;
  logsEnabled: boolean;
  minimumLogLevel: string;
  maxBreadcrumbs: number;

  constructor(input: ConfigurationInput = {}) {
    this.endpoint = input.endpoint ?? process.env.ERRORGAP_ENDPOINT ?? "http://127.0.0.1:3030";
    this.projectSlug = input.projectSlug ?? process.env.ERRORGAP_PROJECT_SLUG;
    this.projectId = input.projectId ?? process.env.ERRORGAP_PROJECT_ID;
    this.apiKey = input.apiKey ?? process.env.ERRORGAP_API_KEY;
    this.environment = input.environment ?? process.env.NODE_ENV ?? "production";
    // Unset, the release is the hosting platform's commit variable or the
    // git checkout's HEAD.
    this.release = input.release ?? detectRelease(input.rootDirectory ?? process.cwd());
    this.async = input.async ?? true;
    this.logger = input.logger === undefined ? console : input.logger;
    this.filterKeys = input.filterKeys ?? [...DEFAULT_FILTER_KEYS];
    this.beforeNotify = input.beforeNotify;
    this.remoteSettings = input.remoteSettings ?? REMOTE_SETTINGS_DEFAULT;
    this.ignoreEnvironments = input.ignoreEnvironments ?? IGNORE_ENV_DEFAULT;
    this.timeout = input.timeout ?? 5;
    this.queueSize = input.queueSize ?? 100;
    this.rootDirectory = input.rootDirectory ?? process.cwd();
    this.apmEnabled = input.apmEnabled ?? true;
    this.apmSampleRate = clampRate(input.apmSampleRate ?? 1);
    this.logsEnabled = input.logsEnabled ?? true;
    this.minimumLogLevel = input.minimumLogLevel ?? "info";
    this.maxBreadcrumbs = Math.max(0, Math.trunc(input.maxBreadcrumbs ?? 25));
  }

  ignoredEnvironment(): boolean {
    return this.ignoreEnvironments.includes(this.environment);
  }

  validate(): void {
    if (!this.endpoint || this.endpoint.trim().length === 0) {
      throw new Error("Errorgap endpoint is required");
    }
    if (!this.projectSlug || this.projectSlug.trim().length === 0) {
      throw new Error("Errorgap projectSlug is required");
    }
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1, Math.max(0, rate));
}
