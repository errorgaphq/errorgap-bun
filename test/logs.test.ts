import { describe, it, expect } from "bun:test";
import { normalizeLogLevel, logLevelRank } from "../src/logs.js";

describe("normalizeLogLevel", () => {
  it("canonicalizes aliases", () => {
    expect(normalizeLogLevel("WARNING")).toBe("warn");
    expect(normalizeLogLevel("critical")).toBe("error");
    expect(normalizeLogLevel("notice")).toBe("info");
    expect(normalizeLogLevel("finest")).toBe("debug");
  });

  it("passes through canonical levels and defaults unknowns", () => {
    expect(normalizeLogLevel("fatal")).toBe("fatal");
    expect(normalizeLogLevel("nonsense")).toBe("info");
  });
});

describe("logLevelRank", () => {
  it("orders severities", () => {
    expect(logLevelRank("trace")).toBeLessThan(logLevelRank("debug"));
    expect(logLevelRank("info")).toBeLessThan(logLevelRank("warn"));
    expect(logLevelRank("warn")).toBeLessThan(logLevelRank("error"));
    expect(logLevelRank("error")).toBeLessThan(logLevelRank("fatal"));
  });
});
