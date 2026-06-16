import { describe, it, expect } from "bun:test";
import { filterParams } from "../src/filter.js";

const DEFAULTS = ["password", "token", "secret", "api_key", "authorization", "cookie"];

describe("filterParams", () => {
  it("masks filtered keys", () => {
    const out = filterParams(
      { username: "alice", password: "hunter2", access_token: "x" },
      DEFAULTS,
    );
    expect(out.username).toBe("alice");
    expect(out.password).toBe("[FILTERED]");
    expect(out.access_token).toBe("[FILTERED]");
  });

  it("recurses into nested objects", () => {
    const out = filterParams(
      { user: { name: "alice", api_key: "x" } },
      DEFAULTS,
    );
    expect((out.user as Record<string, unknown>).name).toBe("alice");
    expect((out.user as Record<string, unknown>).api_key).toBe("[FILTERED]");
  });

  it("case-insensitive", () => {
    const out = filterParams({ Authorization: "Bearer xyz" }, DEFAULTS);
    expect(out.Authorization).toBe("[FILTERED]");
  });
});
