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
