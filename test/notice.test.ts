import { describe, it, expect } from "bun:test";
import { Configuration } from "../src/configuration.js";
import { buildNotice } from "../src/notice.js";
import { VERSION } from "../src/version.js";

describe("buildNotice", () => {
  const cfg = new Configuration({
    endpoint: "https://e.example.com",
    projectSlug: "demo",
    projectId: "p_1",
    environment: "test",
    release: "1.2.3",
  });

  it("captures type and message", () => {
    const notice = buildNotice(new TypeError("boom"), cfg);
    expect(notice.errors[0]?.type).toBe("TypeError");
    expect(notice.errors[0]?.message).toBe("boom");
  });

  it("includes notifier identification + runtime", () => {
    const notice = buildNotice(new Error("x"), cfg);
    expect(notice.context.notifier).toBe("errorgap-bun");
    expect(notice.context.notifier_version).toBe(VERSION);
    expect(notice.context.environment).toBe("test");
    expect(notice.context.release).toBe("1.2.3");
    expect(notice.context.runtime).toBe("bun");
  });

  it("filters sensitive params", () => {
    const notice = buildNotice(new Error("x"), cfg, {
      params: { username: "alice", password: "hunter2" },
    });
    expect(notice.params.username).toBe("alice");
    expect(notice.params.password).toBe("[FILTERED]");
  });

  it("includes project_id", () => {
    const notice = buildNotice(new Error("x"), cfg);
    expect(notice.project_id).toBe("p_1");
  });
});

describe("buildNotice cause chains", () => {
  const cfg = new Configuration({ endpoint: "https://e.example.com", projectSlug: "demo" });

  it("records nested causes in context and merges their frames", () => {
    const root = new Error("db connection refused");
    root.name = "ConnectionError";
    const mid = new Error("failed to load order", { cause: root });
    mid.name = "RepositoryError";
    const top = new Error("checkout failed", { cause: mid });
    top.name = "CheckoutError";

    const notice = buildNotice(top, cfg);
    expect(notice.errors[0]?.type).toBe("CheckoutError");
    const causes = notice.context.causes as Array<{ type: string; message: string }>;
    expect(causes).toEqual([
      { type: "RepositoryError", message: "failed to load order" },
      { type: "ConnectionError", message: "db connection refused" },
    ]);
    notice.errors[0]!.backtrace.forEach((frame, i) => expect(frame.index).toBe(i));
  });

  it("omits causes when there is no cause chain", () => {
    const notice = buildNotice(new Error("solo"), cfg);
    expect(notice.context.causes).toBeUndefined();
  });
});

describe("buildNotice breadcrumbs", () => {
  const cfg = new Configuration({ endpoint: "https://e.example.com", projectSlug: "demo" });

  it("attaches provided breadcrumbs to context", () => {
    const notice = buildNotice(new Error("x"), cfg, {
      breadcrumbs: [{ message: "handled GET /orders", timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    const crumbs = notice.context.breadcrumbs as Array<{ message: string }>;
    expect(crumbs[0]?.message).toBe("handled GET /orders");
  });
});
