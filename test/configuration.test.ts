import { describe, it, expect } from "bun:test";
import { Configuration } from "../src/configuration.js";

describe("Configuration", () => {
  it("uses defaults when nothing provided", () => {
    const cfg = new Configuration();
    expect(cfg.endpoint).toBeTruthy();
    expect(cfg.async).toBe(true);
    expect(cfg.filterKeys).toContain("password");
  });

  it("validate throws when projectSlug missing", () => {
    const cfg = new Configuration({ endpoint: "https://e.example.com" });
    expect(() => cfg.validate()).toThrow(/projectSlug/);
  });

  it("validate throws when endpoint missing", () => {
    const cfg = new Configuration({ endpoint: "", projectSlug: "demo" });
    expect(() => cfg.validate()).toThrow(/endpoint/);
  });

  it("validate passes with both", () => {
    const cfg = new Configuration({
      endpoint: "https://e.example.com",
      projectSlug: "demo",
    });
    expect(() => cfg.validate()).not.toThrow();
  });
});
