import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Errorgap, browserTraceId, routeName, withErrorgap } from "../src/index.js";

interface Captured {
  path: string;
  body: Record<string, any>;
}

describe("withErrorgap", () => {
  const requests: Captured[] = [];
  let ingestor: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    requests.length = 0;
    ingestor = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        requests.push({ path: new URL(req.url).pathname, body: (await req.json()) as Record<string, any> });
        return new Response("{}", { status: 201 });
      },
    });
    Errorgap.init({
      endpoint: `http://127.0.0.1:${ingestor.port}`,
      projectSlug: "demo",
      async: false,
      captureGlobals: false,
      apmEnabled: true,
    });
  });
  afterEach(() => ingestor.stop(true));

  async function settle(count: number): Promise<void> {
    for (let i = 0; i < 100 && requests.length < count; i++) await Bun.sleep(10);
    await Errorgap.flush();
  }
  const of = (kind: string) => requests.filter((r) => r.path.endsWith(`/${kind}`)).map((r) => r.body);

  it("records a Bun.serve request with its route, status, browser trace and linked errors", async () => {
    const app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: withErrorgap(async (request) => {
        await Bun.sleep(2);
        void Errorgap.notify(new Error("card declined"), { sync: true });
        if (new URL(request.url).pathname === "/boom") throw new Error("kaboom");
        return new Response("ok", { status: 201 });
      }),
      error: () => new Response("oops", { status: 500 }),
    });
    try {
      const ok = await fetch(`http://127.0.0.1:${app.port}/orders/123?x=1`, {
        headers: { "x-errorgap-trace": "0192F3C4-7A1B-4C2D-9E3F-0123456789AB" },
      });
      expect(ok.status).toBe(201);
      const boom = await fetch(`http://127.0.0.1:${app.port}/boom`, { headers: { "x-errorgap-trace": "nope" } });
      expect(boom.status).toBe(500);
      await settle(5);
    } finally {
      app.stop(true);
    }

    const txns = of("transactions");
    const ok = txns.find((t) => t.path_raw === "/orders/123")!;
    const boom = txns.find((t) => t.path_raw === "/boom")!;
    expect(ok.path).toBe("/orders/:id");
    expect(ok.status_code).toBe(201);
    expect(ok.trace_id).toBe("0192f3c4-7a1b-4c2d-9e3f-0123456789ab");
    expect(boom.status_code).toBe(500);
    expect(boom.trace_id).toBeUndefined();
    const notices = of("notices");
    const kaboom = notices.find((n) => n.errors[0].message === "kaboom")!;
    expect(kaboom.context.transaction_id).toBe(boom.id);
    const declined = notices.filter((n) => n.errors[0].message === "card declined").map((n) => n.context.transaction_id);
    expect(declined.sort()).toEqual([ok.id, boom.id].sort());
  });

  it("validates trace ids and names routes", () => {
    expect(browserTraceId("not-a-uuid")).toBeUndefined();
    expect(routeName("/orders/123/items/0192f3c4-7a1b-4c2d-9e3f-0123456789ab")).toBe("/orders/:id/items/:id");
    expect(routeName("/about")).toBe("/about");
  });
});
