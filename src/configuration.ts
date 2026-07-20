export interface Logger {
  warn(message: string, ...args: unknown[]): void;
}

export interface ConfigurationInput {
  endpoint?: string;
  projectSlug?: string;
  projectId?: string;
  apiKey?: string;
  environment?: string;
  release?: string;
  async?: boolean;
  logger?: Logger | null;
  filterKeys?: string[];
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
  filterKeys: string[];
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
    this.release = input.release ?? process.env.ERRORGAP_RELEASE;
    this.async = input.async ?? true;
    this.logger = input.logger === undefined ? console : input.logger;
    this.filterKeys = input.filterKeys ?? [...DEFAULT_FILTER_KEYS];
    this.rootDirectory = input.rootDirectory ?? process.cwd();
    this.apmEnabled = input.apmEnabled ?? true;
    this.apmSampleRate = clampRate(input.apmSampleRate ?? 1);
    this.logsEnabled = input.logsEnabled ?? true;
    this.minimumLogLevel = input.minimumLogLevel ?? "info";
    this.maxBreadcrumbs = Math.max(0, Math.trunc(input.maxBreadcrumbs ?? 25));
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
