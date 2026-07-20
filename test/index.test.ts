import { describe, it, expect, beforeEach } from "bun:test";
import { Errorgap } from "../src/index.js";

interface Captured {
  path: string;
  body: Record<string, unknown>;
}

async function startIngestor(): Promise<{
  endpoint: string;
  requests: Captured[];
  close: () => void;
}> {
  const requests: Captured[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        /* leave */
      }
      requests.push({ path: new URL(req.url).pathname, body });
      return new Response('{"group_id":"g_1"}', { status: 201 });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  };
}

describe("Errorgap top-level API", () => {
  let ing: Awaited<ReturnType<typeof startIngestor>>;

  beforeEach(async () => {
    ing = await startIngestor();
    Errorgap.init({
      endpoint: ing.endpoint,
      projectSlug: "demo",
      apiKey: "flk_test",
      async: false,
      captureGlobals: false,
    });
    Errorgap.clearBreadcrumbs();
  });

  it("attaches recorded breadcrumbs to notices", async () => {
    Errorgap.addBreadcrumb("received request", { category: "http" });
    Errorgap.addBreadcrumb("ran query", { category: "db" });
    await Errorgap.notify(new Error("boom"), { sync: true });
    ing.close();

    const notice = ing.requests.find((r) => r.path.endsWith("/notices"))!;
    const crumbs = (notice.body.context as Record<string, unknown>).breadcrumbs as Array<{
      message: string;
    }>;
    expect(crumbs.map((c) => c.message)).toEqual(["received request", "ran query"]);
  });

  it("trackTransaction times an operation and records its spans", async () => {
    await Errorgap.trackTransaction(
      { method: "GET", path: "/orders/{orderId}", pathRaw: "/orders/7" },
      async (spans) => {
        spans.database("SELECT * FROM orders WHERE id = 7", 4, { function: "Repo.load" });
        spans.external(30, { function: "Gateway.fetch" });
      },
    );
    await Errorgap.flush();
    ing.close();

    const txn = ing.requests.find((r) => r.path.endsWith("/transactions"))!;
    expect(txn.body).toMatchObject({ kind: "web", path: "/orders/{orderId}", path_raw: "/orders/7" });
    expect((txn.body.spans as unknown[]).length).toBe(2);
  });

  it("trackJob delivers a background job transaction", async () => {
    await Errorgap.trackJob(
      "ReceiptJob",
      async (spans) => {
        spans.database("SELECT 1", 2);
      },
      { queue: "mailers" },
    );
    await Errorgap.flush();
    ing.close();

    const txn = ing.requests.find((r) => r.path.endsWith("/transactions"))!;
    expect(txn.body).toMatchObject({ kind: "job", job_class: "ReceiptJob", queue: "mailers" });
  });

  it("log delivers a structured log line", async () => {
    await Errorgap.log("payment captured", "info", { source: "payments" });
    await Errorgap.flush();
    ing.close();

    const log = ing.requests.find((r) => r.path.endsWith("/logs"))!;
    expect(log.body).toMatchObject({ message: "payment captured", level: "info", source: "payments" });
  });
});
