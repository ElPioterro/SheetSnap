/**
 * Pre-package hook: stage the standalone Next.js server for electron-builder.
 *
 * electron-builder's `extraResources` copies `dist-resources/server` into the
 * packaged app's `resources/server`, where `electron/main.cjs` spawns it via
 *     node resources/server/server.js
 * (using Electron's own binary as Node). This script produces that folder from
 * the finalized `.next/standalone` output, and sanity-checks that the native
 * dependencies the server needs at runtime actually rode along in the trace.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const dest = path.join(root, "dist-resources", "server");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error(
    "[assemble] .next/standalone/server.js not found. Run `npm run build` first.",
  );
  process.exit(1);
}

// Fresh copy every time so stale files never leak into an installer.
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
// `dereference: true` resolves symlinks into real files. Next's standalone
// output symlinks some node_modules, and recreating symlinks on Windows needs
// elevated privileges (EPERM) — copying the targets keeps the bundle portable.
fs.cpSync(standalone, dest, { recursive: true, dereference: true });

// Guard against the classic silent-packaging failure: the standalone trace
// dropped a native dependency, producing an installer that crashes on launch.
const mustExist = [
  ["ffmpeg-static", path.join(dest, "node_modules", "ffmpeg-static")],
  ["sharp", path.join(dest, "node_modules", "sharp")],
];
const missing = mustExist.filter(([, p]) => !fs.existsSync(p));
if (missing.length) {
  console.error(
    `[assemble] standalone bundle is missing: ${missing.map(([n]) => n).join(", ")}`,
  );
  process.exit(1);
}

// sharp's actual binary lives in a platform-specific optional dependency
// (@img/sharp-<platform>); warn loudly if none was traced for this platform.
const imgDir = path.join(dest, "node_modules", "@img");
const hasImg =
  fs.existsSync(imgDir) &&
  fs.readdirSync(imgDir).some((n) => /^sharp-(?!libvips)/.test(n));
if (!hasImg) {
  console.warn(
    "[assemble] WARNING: no @img/sharp-<platform> binary found in the bundle — " +
      "image processing may fail at runtime on the target OS.",
  );
}

console.log(`[assemble] staged standalone server → ${path.relative(root, dest)}`);
