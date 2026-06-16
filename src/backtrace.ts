export interface BacktraceFrame {
  file?: string;
  line?: number;
  function?: string;
  in_app?: boolean;
  index: number;
}

const V8_AT = /^\s*at\s+(?:(.*?)\s+\()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/;

export function parseBacktrace(error: Error): BacktraceFrame[] {
  const stack = typeof error.stack === "string" ? error.stack : "";
  if (!stack) return [];
  const lines = stack.split("\n");
  const frames: BacktraceFrame[] = [];
  let index = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("at ")) continue;
    const m = trimmed.match(V8_AT);
    if (!m) continue;
    const fnName = m[1];
    const location = (m[2] ?? "").replace(/^file:\/\//, "");
    const lineNumber = m[3] ? Number(m[3]) : undefined;
    frames.push({
      file: location,
      line: lineNumber,
      function: fnName || undefined,
      in_app: isInApp(location),
      index: index++,
    });
  }
  return frames;
}

function isInApp(file: string): boolean {
  if (!file) return false;
  if (file.includes("/node_modules/")) return false;
  if (file.startsWith("node:")) return false;
  if (file.startsWith("bun:")) return false; // Bun internal modules
  return true;
}
