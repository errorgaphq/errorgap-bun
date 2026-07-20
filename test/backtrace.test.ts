import { describe, it, expect } from "bun:test";
import { parseBacktrace } from "../src/backtrace.js";

describe("parseBacktrace", () => {
  it("returns empty array when stack missing", () => {
    const err = new Error("x");
    err.stack = undefined as unknown as string;
    expect(parseBacktrace(err)).toEqual([]);
  });

  it("captures column and reads source from the real error site", () => {
    let err!: Error;
    function boom() {
      err = new Error("boom");
    }
    boom();

    const frames = parseBacktrace(err, process.cwd());
    const appFrame = frames.find(
      (f) => f.in_app && (f.file ?? "").includes("backtrace.test.ts"),
    );
    expect(appFrame).toBeDefined();
    expect(typeof appFrame!.line).toBe("number");
    expect(typeof appFrame!.column).toBe("number");
    expect(appFrame!.source).toBeDefined();
    expect(appFrame!.source!.lines.some((l) => l.includes("new Error"))).toBe(true);
  });

  it("classifies node_modules and internal frames as not in_app", () => {
    const err = new Error("x");
    err.stack = [
      "Error: x",
      "    at handler (/app/src/app.ts:10:5)",
      "    at load (/app/node_modules/pg/lib/client.js:1:1)",
      "    at emit (node:events:1:1)",
    ].join("\n");
    const frames = parseBacktrace(err, "/app");
    expect(frames[0]?.in_app).toBe(true);
    expect(frames[1]?.in_app).toBe(false);
    expect(frames[2]?.in_app).toBe(false);
    expect(frames[0]?.file).toBe("src/app.ts");
  });
});
