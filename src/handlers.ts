import type { Client } from "./client.js";
import type { BreadcrumbBuffer } from "./breadcrumbs.js";

let installed = false;
let uncaughtHandler: ((err: Error) => void) | null = null;
let rejectionHandler: ((reason: unknown) => void) | null = null;

/**
 * Hook Bun's `uncaughtException` and `unhandledRejection` events on the
 * Node-compatible `process` global.
 */
export function installProcessHandlers(client: Client, breadcrumbs?: BreadcrumbBuffer): void {
  if (installed) return;
  installed = true;
  const snapshot = () => breadcrumbs?.snapshot() ?? [];

  uncaughtHandler = (err: Error) => {
    void client.notify(err, {
      sync: true,
      context: { source: "uncaughtException" },
      breadcrumbs: snapshot(),
    });
  };
  rejectionHandler = (reason: unknown) => {
    void client.notify(reason, {
      sync: true,
      context: { source: "unhandledRejection" },
      breadcrumbs: snapshot(),
    });
  };
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
