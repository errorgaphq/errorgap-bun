import { describe, it, expect } from "bun:test";
import { BreadcrumbBuffer } from "../src/breadcrumbs.js";

describe("BreadcrumbBuffer", () => {
  it("records message, category, and metadata with a timestamp", () => {
    const buffer = new BreadcrumbBuffer(10);
    buffer.add("handled request", { category: "http", metadata: { path: "/orders" } });
    const [crumb] = buffer.snapshot();
    expect(crumb?.message).toBe("handled request");
    expect(crumb?.category).toBe("http");
    expect(crumb?.metadata).toEqual({ path: "/orders" });
    expect(typeof crumb?.timestamp).toBe("string");
  });

  it("drops the oldest crumbs beyond capacity", () => {
    const buffer = new BreadcrumbBuffer(3);
    for (let i = 0; i < 5; i++) buffer.add(`event ${i}`);
    expect(buffer.snapshot().map((c) => c.message)).toEqual(["event 2", "event 3", "event 4"]);
  });

  it("keeps nothing when capacity is zero", () => {
    const buffer = new BreadcrumbBuffer(0);
    buffer.add("ignored");
    expect(buffer.snapshot()).toEqual([]);
  });

  it("clears recorded crumbs", () => {
    const buffer = new BreadcrumbBuffer(5);
    buffer.add("one");
    buffer.clear();
    expect(buffer.snapshot()).toEqual([]);
  });
});
