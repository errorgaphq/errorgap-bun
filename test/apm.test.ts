import { describe, it, expect } from "bun:test";
import { Configuration } from "../src/configuration.js";
import {
  SpanCollector,
  databaseSpan,
  externalSpan,
  normalizeSql,
  transactionPayload,
} from "../src/apm.js";

describe("normalizeSql", () => {
  it("replaces string and numeric literals", () => {
    expect(normalizeSql("SELECT * FROM orders WHERE id = 42 AND name = 'alice'")).toBe(
      "SELECT * FROM orders WHERE id = ? AND name = ?",
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeSql("SELECT\n  1\n  FROM   t")).toBe("SELECT ? FROM t");
  });
});

describe("span builders", () => {
  it("builds a normalized db span", () => {
    const span = databaseSpan("SELECT * FROM t WHERE id = 7", 12.5, {
      file: "src/repo.ts",
      line: 20,
      function: "OrderRepo.load",
    });
    expect(span.kind).toBe("db");
    expect(span.sql).toBe("SELECT * FROM t WHERE id = ?");
    expect(span.durationMs).toBe(12.5);
    expect(span.function).toBe("OrderRepo.load");
  });

  it("builds an external http span", () => {
    const span = externalSpan(88, { function: "PaymentGateway.charge" });
    expect(span.kind).toBe("http");
    expect(span.sql).toBeUndefined();
  });
});

describe("transactionPayload", () => {
  const cfg = new Configuration({
    endpoint: "https://e.example.com",
    projectSlug: "demo",
    environment: "production",
  });

  it("maps a web transaction with spans to the ingest shape", () => {
    const collector = new SpanCollector();
    collector.database("SELECT 1", 3, { function: "Repo.q" });
    collector.external(50, { function: "Api.call" });
    const payload = transactionPayload(
      {
        kind: "web",
        method: "POST",
        path: "/orders/{orderId}",
        pathRaw: "/orders/123",
        statusCode: 201,
        durationMs: 120,
        spans: collector.snapshot(),
      },
      cfg,
    );
    expect(payload.kind).toBe("web");
    expect(payload.path).toBe("/orders/{orderId}");
    expect(payload.path_raw).toBe("/orders/123");
    expect(payload.status_code).toBe(201);
    expect(payload.environment).toBe("production");
    const spans = payload.spans as Array<Record<string, unknown>>;
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ kind: "db", sql: "SELECT ?", fn_name: "Repo.q" });
  });

  it("maps a background job transaction", () => {
    const payload = transactionPayload(
      { kind: "job", jobClass: "ReceiptJob", queue: "mailers", durationMs: 40 },
      cfg,
    );
    expect(payload.kind).toBe("job");
    expect(payload.job_class).toBe("ReceiptJob");
    expect(payload.queue).toBe("mailers");
  });
});
