import type { Client } from "./client.js";
import type { BreadcrumbBuffer } from "./breadcrumbs.js";

let installed = false;
let uncaughtHandler: ((err: Error) => void) | null = null;
let rejectionHandler: ((reason: unknown) => void) | null = null;

export interface ProcessHandlerOptions {
  /**
   * After reporting an uncaught exception or unhandled rejection, end the
   * process as Bun would have (exit code 1) when no other listener is
   * handling it. Defaults to `true`.
   */
  exitOnUncaught?: boolean;
}

/** How long a crashing process waits for its last report. */
const EXIT_FLUSH_MS = 2000;

/**
 * Hook Bun's `uncaughtException` and `unhandledRejection` events on the
 * Node-compatible `process` global.
 *
 * Listening for these events turns off the runtime's own handling of them,
 * which is to print the error and exit. Report, then do that ourselves: a
 * process that keeps running after an uncaught exception is in an unknown
 * state.
 */
export function installProcessHandlers(
  client: Client,
  breadcrumbs?: BreadcrumbBuffer,
  options: ProcessHandlerOptions = {},
): void {
  if (installed) return;
  installed = true;
  const snapshot = () => breadcrumbs?.snapshot() ?? [];
  const exitOnUncaught = options.exitOnUncaught ?? true;

  const report = (error: unknown, event: "uncaughtException" | "unhandledRejection") => {
    const sent = client
      .notify(error, { sync: true, context: { source: event }, breadcrumbs: snapshot() })
      .catch(() => undefined);
    if (!exitOnUncaught || process.listenerCount(event) > 1) return;

    console.error(error);
    process.exitCode = 1;
    const deadline = new Promise((resolve) => setTimeout(resolve, EXIT_FLUSH_MS));
    void Promise.race([sent, deadline]).then(() => process.exit(1));
  };

  uncaughtHandler = (err: Error) => report(err, "uncaughtException");
  rejectionHandler = (reason: unknown) => report(reason, "unhandledRejection");
  process.on("uncaughtException", uncaughtHandler);
  process.on("unhandledRejection", rejectionHandler);
}

export function uninstallProcessHandlers(): void {
  if (!installed) return;
  if (uncaughtHandler) process.off("uncaughtException", uncaughtHandler);
  if (rejectionHandler) process.off("unhandledRejection", rejectionHandler);
  uncaughtHandler = null;
  rejectionHandler = null;
  installed = false;
}
