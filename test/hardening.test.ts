import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client.js";
import { Configuration } from "../src/configuration.js";
import { Delivery, RateLimitedError, retryable } from "../src/delivery.js";
import { filterParams } from "../src/filter.js";
import { detectRelease } from "../src/release.js";

let server: ReturnType<typeof Bun.serve> | undefined;

/** Answers each request with the next scripted [status, headers] pair. */
function stub(responses: Array<[number, Record<string, string>?]>) {
  const bodies: any[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      bodies.push(await request.json());
      const [status, headers] = responses.length > 1 ? responses.shift()! : responses[0]!;
      return new Response("{}", { status, headers });
    },
  });
  return { endpoint: `http://127.0.0.1:${server.port}`, bodies };
}

function client(endpoint: string, overrides: Record<string, unknown> = {}): Client {
  return new Client(new Configuration({ endpoint, projectSlug: "demo", logger: null, ...overrides }));
}

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("delivery", () => {
  it("sends queued payloads and flush waits for them", async () => {
    const { endpoint, bodies } = stub([[201]]);
    const sdk = client(endpoint);
    for (let n = 0; n < 6; n++) void sdk.notify(new Error(`e${n}`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await sdk.flush();
    expect(bodies).toHaveLength(6);
  });

  it("pauses after a 429 for Retry-After", async () => {
    const { endpoint, bodies } = stub([[429, { "retry-after": "120" }]]);
    const sdk = client(endpoint);
    expect((await sdk.notify(new Error("one"), { sync: true })).status).toBe(429);
    expect((await sdk.notify(new Error("two"), { sync: true })).error).toBeInstanceOf(RateLimitedError);
    expect(bodies).toHaveLength(1);
  });

  it("retries network failures and 5xx, not 4xx or rate limits", () => {
    expect(retryable({ status: 500 })).toBe(true);
    expect(retryable({ error: new Error("refused") })).toBe(true);
    expect(retryable({ status: 422 })).toBe(false);
    expect(retryable({ status: 429 })).toBe(false);
    expect(new Delivery(() => ({}) as never).paused()).toBe(false);
  });
});

describe("notices", () => {
  it("mask nested keys, carry the user and survive unserializable params", async () => {
    const { endpoint, bodies } = stub([[201]]);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await client(endpoint, { filterKeys: ["password", /^ssn$/] }).notify(new Error("x"), {
      sync: true,
      user: { id: 7, email: "ada@example.com" },
      params: { users: [{ password: "p", ssn: "1" }], loop, big: 10n },
    });
    expect(bodies[0].params.users[0]).toEqual({ password: "[FILTERED]", ssn: "[FILTERED]" });
    expect(bodies[0].params.loop.self).toBe("[CIRCULAR]");
    expect(bodies[0].session).toEqual({ user_id: "7", user_email: "ada@example.com" });
    expect(() => JSON.stringify(filterParams({ loop }, []))).not.toThrow();
  });

  it("can be dropped or changed by beforeNotify and are skipped in ignored environments", async () => {
    const { endpoint, bodies } = stub([[201]]);
    const dropped = await client(endpoint, { beforeNotify: () => false }).notify(new Error("a"), { sync: true });
    expect(dropped.body).toBe("dropped by beforeNotify");
    await client(endpoint, {
      beforeNotify: (notice: any) => {
        notice.context.team = "billing";
      },
    }).notify(new Error("b"), { sync: true });
    await client(endpoint, { environment: "test", ignoreEnvironments: ["test"] }).notify(new Error("c"), {
      sync: true,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].context.team).toBe("billing");
  });
});

describe("detectRelease", () => {
  it("prefers the platform variable, then reads .git/HEAD", () => {
    const root = mkdtempSync(join(tmpdir(), "errorgap-"));
    expect(detectRelease(root, {})).toBeUndefined();
    mkdirSync(join(root, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(root, ".git", "refs", "heads", "main"), `${"a".repeat(40)}\n`);
    expect(detectRelease(root, {})).toBe("a".repeat(40));
    expect(detectRelease(root, { SOURCE_VERSION: "env1" })).toBe("env1");
  });
});
