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
