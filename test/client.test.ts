import { describe, it, expect } from "bun:test";
import { Client } from "../src/client.js";
import { Configuration } from "../src/configuration.js";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

async function startIngestor(): Promise<{
  endpoint: string;
  requests: CapturedRequest[];
  close: () => void;
}> {
  const requests: CapturedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const text = await req.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch { /* leave as text */ }
      requests.push({ url: req.url, method: req.method, headers, body });
      return new Response('{"group_id":"g_1"}', {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  };
}

describe("Client", () => {
  it("POSTs to /api/projects/:slug/notices with canonical headers", async () => {
    const ing = await startIngestor();
    try {
      const cfg = new Configuration({
        endpoint: ing.endpoint,
        projectSlug: "demo",
        apiKey: "flk_test",
        async: false,
      });
      const client = new Client(cfg);
      const result = await client.notify(new Error("boom"), { sync: true });
      expect(result.status).toBe(201);
      expect(ing.requests.length).toBe(1);
      const req = ing.requests[0]!;
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/api/projects/demo/notices");
      expect(req.headers["x-errorgap-project-key"]).toBe("flk_test");
      expect(req.headers["user-agent"]).toMatch(/^errorgap-bun\//);
    } finally {
      ing.close();
    }
  });

  it("returns error result when endpoint missing", async () => {
    const cfg = new Configuration({
      endpoint: "",
      projectSlug: "demo",
      logger: null,
    });
    const client = new Client(cfg);
    const result = await client.notify(new Error("x"), { sync: true });
    expect(result.error).toBeDefined();
  });
});

describe("Client logs and transactions", () => {
  function cfg(ing: { endpoint: string }, overrides: Record<string, unknown> = {}) {
    return new Configuration({
      endpoint: ing.endpoint,
      projectSlug: "demo",
      apiKey: "flk_test",
      async: false,
      ...overrides,
    });
  }

  it("POSTs a structured log to /logs", async () => {
    const ing = await startIngestor();
    try {
      const client = new Client(cfg(ing));
      const result = await client.notifyLog("gateway timeout", "error", {
        source: "payments",
        sync: true,
      });
      expect(result.status).toBe(201);
      const req = ing.requests[0]!;
      expect(new URL(req.url).pathname).toBe("/api/projects/demo/logs");
      expect(req.body).toMatchObject({ message: "gateway timeout", level: "error", source: "payments" });
    } finally {
      ing.close();
    }
  });

  it("drops logs below the minimum level", async () => {
    const ing = await startIngestor();
    try {
      const client = new Client(cfg(ing, { minimumLogLevel: "warn" }));
      const result = await client.notifyLog("chatty", "info", { sync: true });
      expect(result.status).toBe(204);
      expect(ing.requests.length).toBe(0);
    } finally {
      ing.close();
    }
  });

  it("POSTs an APM transaction to /transactions", async () => {
    const ing = await startIngestor();
    try {
      const client = new Client(cfg(ing));
      const result = await client.notifyTransaction(
        { kind: "web", method: "GET", path: "/orders/{id}", pathRaw: "/orders/1", durationMs: 10 },
        { sync: true },
      );
      expect(result.status).toBe(201);
      const req = ing.requests[0]!;
      expect(new URL(req.url).pathname).toBe("/api/projects/demo/transactions");
      expect(req.body).toMatchObject({ kind: "web", path: "/orders/{id}", path_raw: "/orders/1" });
    } finally {
      ing.close();
    }
  });

  it("skips transactions when APM is disabled", async () => {
    const ing = await startIngestor();
    try {
      const client = new Client(cfg(ing, { apmEnabled: false }));
      const result = await client.notifyTransaction({ durationMs: 5 }, { sync: true });
      expect(result.status).toBe(204);
      expect(ing.requests.length).toBe(0);
    } finally {
      ing.close();
    }
  });
});
