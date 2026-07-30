import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS project directory. Without it, Turbopack
  // walks up looking for lockfiles and may pick a parent's package-lock.json
  // (e.g. C:\Users\<name>\package-lock.json), producing the
  // "Next.js inferred your workspace root" warning — and wrong module
  // resolution on machines that happen to have one.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  // Self-contained server output for the Electron desktop build (PACKAGING.md).
  output: "standalone",
  // Keep native/binary packages external so their on-disk resolution
  // (ffmpeg binary, libvips) survives bundling.
  serverExternalPackages: ["ffmpeg-static", "sharp", "archiver"],
  // The standalone server only needs the compiled output + node_modules.
  // Prune source/docs/data/desktop-shell files from the runtime file trace
  // so `.next/standalone` stays lean (they're build-time or user-data only).
  outputFileTracingExcludes: {
    "*": [
      "data/**",
      "electron/**",
      "scripts/**",
      "src/**",
      "**/*.md",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "tsconfig.json",
    ],
  },
};

export default nextConfig;
