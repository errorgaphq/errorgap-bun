import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Errorgap, currentTransactionId, runInTransaction } from "../src/index.js";

interface Captured {
  path: string;
  body: Record<string, any>;
}

// Errors reported during a transaction carry its id, so errorgap shows the
// error a request actually raised on its trace and links the two.
describe("transaction ids", () => {
  const requests: Captured[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    requests.length = 0;
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        requests.push({ path: new URL(req.url).pathname, body: (await req.json()) as Record<string, any> });
        return new Response("{}", { status: 201 });
      },
    });
    Errorgap.init({
      endpoint: `http://127.0.0.1:${server.port}`,
      projectSlug: "demo",
      apiKey: "egp_test",
      async: false,
      captureGlobals: false,
      apmEnabled: true,
      apmSampleRate: 1,
    });
  });
  afterEach(() => server.stop(true));

  it("links an error to the transaction it was raised in", async () => {
    let seen: string | undefined;
    await Errorgap.trackTransaction({ method: "GET", path: "/orders/{id}" }, async () => {
      await Bun.sleep(1);
      seen = currentTransactionId();
      await Errorgap.notify(new Error("card declined"), { sync: true });
    });
    await Errorgap.notify(new Error("after"), { sync: true });
    await Errorgap.flush();

    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    const transaction = requests.find((r) => r.path.endsWith("/transactions"))!;
    expect(transaction.body.id).toBe(seen);
    const inside = requests.find((r) => r.body.errors?.[0]?.message === "card declined")!;
    const after = requests.find((r) => r.body.errors?.[0]?.message === "after")!;
    expect(inside.body.context.transaction_id).toBe(seen);
    expect(after.body.context.transaction_id).toBeUndefined();
    expect(currentTransactionId()).toBeUndefined();
  });

  it("gives each job its own id", async () => {
    let jobId: string | undefined;
    await Errorgap.trackJob("ReceiptJob", () => {
      jobId = currentTransactionId();
    });
    await Errorgap.flush();
    expect(requests.find((r) => r.path.endsWith("/transactions"))!.body.id).toBe(jobId);
  });

  it("keeps concurrent flows apart and an explicit id wins", async () => {
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        runInTransaction(id, async () => {
          await Bun.sleep(5);
          return currentTransactionId();
        }),
      ),
    );
    expect(results).toEqual(["a", "b"]);

    await runInTransaction("scoped", () =>
      Errorgap.notify(new Error("x"), { context: { transaction_id: "mine" }, sync: true }),
    );
    expect(requests.at(-1)!.body.context.transaction_id).toBe("mine");
  });
});
