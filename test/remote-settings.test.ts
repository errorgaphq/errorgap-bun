import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "../src/client.js";
import { Configuration } from "../src/configuration.js";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("remote settings", () => {
  it("stop a switched-off kind being sent and stay on when unreadable", async () => {
    const seen: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch(request) {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === "GET") {
          return Response.json({ errors_enabled: false, apm_enabled: true, poll_interval_seconds: 600 });
        }
        return new Response("{}", { status: 201 });
      },
    });
    const sdk = new Client(
      new Configuration({ endpoint: `http://127.0.0.1:${server.port}`, projectSlug: "demo", logger: null, remoteSettings: true }),
    );
    expect(await sdk.remote.refresh()).toBe(true);
    expect(seen[0]).toBe("GET /api/projects/demo/config");
    await sdk.notify(new Error("x"), { sync: true });
    expect(seen.some((line) => line.startsWith("POST"))).toBe(false);
    expect((await sdk.notifyLog("still sent", "error", { sync: true })).status).toBe(201);
    sdk.remote.stop();

    const unreachable = new Client(
      new Configuration({ endpoint: "http://127.0.0.1:1", projectSlug: "demo", logger: null, remoteSettings: true }),
    );
    expect(await unreachable.remote.refresh()).toBe(false);
    expect(unreachable.remote.enabled("errors")).toBe(true);
    unreachable.remote.stop();
  });
});
