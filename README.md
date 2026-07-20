# @errorgap/bun

Bun notifier for [Errorgap](https://errorgap.com). Captures errors with
source-aware backtraces, nested `Error.cause` chains, breadcrumbs, structured
logs, and APM transactions.

Because Bun executes TypeScript directly, backtrace frames point at the
original source, so each frame ships a source excerpt (file, line, function,
and surrounding lines) read straight from disk — the dashboard renders
highlighted source with no build step or source maps.

Requires Bun 1.0+.

## Install

```sh
bun add @errorgap/bun
```

The package ships as TypeScript source — no build step. Bun loads it
directly.

## Configure

```ts
import { Errorgap } from "@errorgap/bun";

Errorgap.init({
  endpoint:    process.env.ERRORGAP_ENDPOINT,
  projectSlug: process.env.ERRORGAP_PROJECT_SLUG,
  apiKey:      process.env.ERRORGAP_API_KEY,
  environment: process.env.NODE_ENV ?? "production",
});
```

`init` reads `ERRORGAP_*` env vars when fields are omitted. By default
it installs `process.on("uncaughtException")` and
`process.on("unhandledRejection")`; pass `captureGlobals: false` to skip.

## Manual notification

```ts
try {
  await risky();
} catch (err) {
  await Errorgap.notify(err, { context: { component: "checkout" } });
  throw err;
}
```

`notify` returns a `DeliveryResult` (`status`, `body`, `error`, `queued`).
The SDK never throws.

Nested errors are captured automatically: pass a chain built with
`new Error("…", { cause })` and each cause's type/message lands in
`context.causes` while its frames merge into the backtrace.

## Breadcrumbs

```ts
Errorgap.addBreadcrumb("received GET /orders", { category: "http" });
```

Recorded breadcrumbs attach to every notice as `context.breadcrumbs`.

## Structured logs

```ts
await Errorgap.log("payment gateway timeout", "error", { source: "payments" });
```

Levels are `trace < debug < info < warn < error < fatal`; anything below
`minimumLogLevel` is dropped client-side.

## Performance (APM)

```ts
await Errorgap.trackTransaction(
  { method: "GET", path: "/orders/{orderId}", pathRaw: "/orders/123" },
  async (spans) => {
    spans.database("SELECT * FROM orders WHERE id = 123", 4.2, { function: "OrderRepo.get" });
    spans.external(88, { function: "PaymentGateway.charge" });
    await handleRequest();
  },
);

await Errorgap.trackJob("ReceiptJob", async (spans) => {
  spans.database("INSERT INTO receipts …", 6);
}, { queue: "mailers" });
```

`path` is the normalized route template used for grouping; `path_raw` is the
concrete URL. Both helpers time the callback and deliver on completion. Use
`Errorgap.notifyTransaction(...)` for a pre-measured transaction.

## Configuration reference

| Option | Default | Notes |
|---|---|---|
| `endpoint` | `ERRORGAP_ENDPOINT` or `http://127.0.0.1:3030` | |
| `projectSlug` | `ERRORGAP_PROJECT_SLUG` | **Required** |
| `projectId` | `ERRORGAP_PROJECT_ID` | |
| `apiKey` | `ERRORGAP_API_KEY` | Sent as `x-errorgap-project-key` |
| `environment` | `NODE_ENV` or `"production"` | |
| `release` | `ERRORGAP_RELEASE` | |
| `rootDirectory` | `process.cwd()` | Relativizes backtrace source paths |
| `async` | `true` | Fire-and-forget delivery |
| `logger` | `console` | Pass `null` to silence |
| `filterKeys` | `["password", "token", ...]` | Substring, case-insensitive |
| `apmEnabled` | `true` | Deliver APM transactions |
| `apmSampleRate` | `1.0` | Fraction (0..1) of transactions delivered |
| `logsEnabled` | `true` | Deliver structured logs |
| `minimumLogLevel` | `info` | Drop logs below this level |
| `maxBreadcrumbs` | `25` | Breadcrumbs retained per notice |
| `captureGlobals` | `true` | Install process error hooks |

## Graceful flush

```ts
await Errorgap.flush();
```

## Development

```sh
bun install
bun test
```

## License

MIT.
