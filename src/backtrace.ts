import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface SourceExcerpt {
  start_line: number;
  lines: string[];
}

export interface BacktraceFrame {
  file?: string;
  line?: number;
  column?: number;
  function?: string;
  in_app?: boolean;
  index: number;
  source?: SourceExcerpt;
}

const V8_AT = /^\s*at\s+(?:(.*?)\s+\()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/;

const SOURCE_CONTEXT_RADIUS = 6;
const MAX_SOURCE_LINE_CHARS = 400;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

/** Cache of file line arrays, keyed by resolved path, for one notice build. */
const fileCache = new Map<string, string[] | null>();

/**
 * Parse a V8-style `Error.stack` into Errorgap frames. Because Bun executes
 * TypeScript directly, frame locations point at the original source files, so
 * each frame's source excerpt is read straight from disk.
 */
export function parseBacktrace(error: Error, rootDirectory?: string): BacktraceFrame[] {
  const stack = typeof error.stack === "string" ? error.stack : "";
  if (!stack) return [];
  fileCache.clear();

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
    const line = m[3] ? Number(m[3]) : undefined;
    const column = m[4] ? Number(m[4]) : undefined;

    const frame: BacktraceFrame = {
      file: displayPath(location, rootDirectory),
      line,
      column,
      function: fnName || undefined,
      in_app: isInApp(location),
      index: index++,
    };

    const source = sourceExcerpt(location, line, rootDirectory);
    if (source) frame.source = source;

    frames.push(frame);
  }

  fileCache.clear();
  return frames;
}

function isInApp(file: string): boolean {
  if (!file) return false;
  if (file.includes("/node_modules/")) return false;
  if (file.startsWith("node:")) return false;
  if (file.startsWith("bun:")) return false; // Bun internal modules
  return true;
}

/** Strip the app root prefix for a cleaner in-app display path. */
function displayPath(file: string, root?: string): string {
  if (!file) return file;
  if (root) {
    const normalized = root.endsWith("/") ? root : root + "/";
    if (file.startsWith(normalized)) return file.slice(normalized.length);
  }
  return file;
}

function sourceExcerpt(
  file: string,
  line: number | undefined,
  root?: string,
): SourceExcerpt | undefined {
  if (!file || !line || line < 1) return undefined;
  if (file.startsWith("node:") || file.startsWith("bun:")) return undefined;

  const contents = readSourceLines(resolvePath(file, root));
  if (!contents || line > contents.length) return undefined;

  const startLine = Math.max(1, line - SOURCE_CONTEXT_RADIUS);
  const endLine = Math.min(contents.length, line + SOURCE_CONTEXT_RADIUS);
  return {
    start_line: startLine,
    lines: contents.slice(startLine - 1, endLine).map((l) => l.slice(0, MAX_SOURCE_LINE_CHARS)),
  };
}

function resolvePath(file: string, root?: string): string {
  if (isAbsolute(file)) return file;
  if (root) return join(root, file);
  return file;
}

function readSourceLines(path: string): string[] | null {
  if (fileCache.has(path)) return fileCache.get(path) ?? null;
  let lines: string[] | null = null;
  try {
    const stat = statSync(path);
    if (stat.isFile() && stat.size <= MAX_SOURCE_FILE_BYTES) {
      lines = readFileSync(path, "utf8").split(/\r?\n/);
    }
  } catch {
    lines = null;
  }
  fileCache.set(path, lines);
  return lines;
}
