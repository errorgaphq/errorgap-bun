# @errorgap/bun

Bun notifier for [Errorgap](https://errorgap.com). Errors only in v1.

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

## Configuration reference

| Option | Default | Notes |
|---|---|---|
| `endpoint` | `ERRORGAP_ENDPOINT` or `http://127.0.0.1:3030` | |
| `projectSlug` | `ERRORGAP_PROJECT_SLUG` | **Required** |
| `projectId` | `ERRORGAP_PROJECT_ID` | |
| `apiKey` | `ERRORGAP_API_KEY` | Sent as `x-errorgap-project-key` |
| `environment` | `NODE_ENV` or `"production"` | |
| `release` | — | |
| `async` | `true` | Fire-and-forget delivery |
| `logger` | `console` | Pass `null` to silence |
| `filterKeys` | `["password", "token", ...]` | Substring, case-insensitive |
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
