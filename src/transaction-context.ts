import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The APM transaction the current async flow is running in, so errors
 * reported during it carry its id as `context.transaction_id` and errorgap
 * links each error to the request or job that raised it. Follows awaits,
 * never leaks into a concurrent request.
 */
const storage = new AsyncLocalStorage<string>();

/** The id of the transaction running now, if any. */
export function currentTransactionId(): string | undefined {
  return storage.getStore();
}

/** Run `operation` with `id` as the current transaction id. */
export function runInTransaction<T>(id: string, operation: () => T): T {
  return storage.run(id, operation);
}

/** A new random transaction id (a UUID). */
export function newTransactionId(): string {
  return crypto.randomUUID();
}
