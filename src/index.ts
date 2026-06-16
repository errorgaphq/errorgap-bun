import { Client, type DeliveryResult } from "./client.js";
import { Configuration, type ConfigurationInput } from "./configuration.js";
import { installProcessHandlers, uninstallProcessHandlers } from "./handlers.js";
import type { NoticeContext } from "./notice.js";
import { VERSION } from "./version.js";

export type { ConfigurationInput, Logger } from "./configuration.js";
export type { BacktraceFrame } from "./backtrace.js";
export type { NoticeContext, NoticePayload } from "./notice.js";
export type { DeliveryResult } from "./client.js";
export { Client } from "./client.js";
export { Configuration } from "./configuration.js";
export { VERSION };

let configuration = new Configuration();
let client = new Client(configuration);

export interface InitOptions extends ConfigurationInput {
  /** Install process.uncaughtException / unhandledRejection handlers. */
  captureGlobals?: boolean;
}

function init(options: InitOptions = {}): void {
  const { captureGlobals = true, ...rest } = options;
  configuration = new Configuration(rest);
  client.configure(configuration);
  if (captureGlobals) {
    installProcessHandlers(client);
  } else {
    uninstallProcessHandlers();
  }
}

function notify(
  error: unknown,
  options: NoticeContext & { sync?: boolean } = {},
): Promise<DeliveryResult> {
  return client.notify(error, options);
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
  notify,
  flush,
  configuration: getConfiguration,
  client: getClient,
  VERSION,
};

export { init, notify, flush };
