/**
 * postbuild hook: makes `.next/standalone` fully self-runnable.
 *
 * Next's standalone output intentionally omits static assets; they must be
 * copied in. After this runs:
 *     node .next/standalone/server.js
 * serves the whole app (same command the packaged desktop build uses).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.log("[finalize-standalone] no standalone output — nothing to do.");
  process.exit(0);
}

fs.cpSync(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);

const publicDir = path.join(root, "public");
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(standalone, "public"), { recursive: true });
}

console.log("[finalize-standalone] .next/standalone is ready (static assets copied).");
