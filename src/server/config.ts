import fs from "node:fs";
import path from "node:path";

/**
 * Central runtime configuration — a plain module, deliberately NOT
 * next.config.ts, so nothing ever pulls Next's config into server runtime
 * code (and the bundler can trace it cleanly).
 *
 * Data directory resolution:
 *   - Packaged desktop builds: SHEETSNAP_DATA_DIR is set by the Electron
 *     main process to the OS-specific user-data folder
 *     (%APPDATA%/SheetSnap, ~/Library/Application Support/SheetSnap,
 *     ~/.config/SheetSnap) — never inside the install directory.
 *   - Local development: ./data at the project root (gitignored), so
 *     `npm install && npm run dev` needs nothing else.
 */

function resolveDataDir(): string {
  const fromEnv = process.env.SHEETSNAP_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

export const DATA_DIR = resolveDataDir();
export const JOBS_DIR = path.join(DATA_DIR, "jobs");

/** Upload size cap in bytes (env override in MB). */
export const MAX_UPLOAD_BYTES =
  Math.max(16, Number(process.env.MAX_UPLOAD_MB ?? 2048)) * 1024 * 1024;

export function jobDir(id: string): string {
  return path.join(JOBS_DIR, id);
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
