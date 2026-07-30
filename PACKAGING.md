# Packaging SheetSnap as a desktop app

Goal: **user double-clicks an installer → app opens → everything works** on
Windows, macOS, and Linux, with nothing pre-installed.

There is no database to provision: persistence is the filesystem
(`data/jobs/<id>/…`), so the only things to bundle are the server, the ffmpeg
binary, and (optionally) yt-dlp.

## Recommended: Electron + electron-builder

Why Electron over Tauri for this project:

- **The backend is already Node.** Electron embeds Node, so the Next.js
  server, sharp (native), ffmpeg-static (native binary), and npm deps run
  unchanged. Tauri would require shipping the same Node stack as *sidecar*
  binaries plus a Rust shell — more moving parts, smaller win here.
- Installers are a solved problem: NSIS (Windows), DMG (macOS),
  AppImage/deb (Linux) out of one config.
- Trade-off accepted: larger bundle (~90 MB compressed) — irrelevant for a
  utility that processes gigabyte videos.

### 1. Wrap the app

`electron/main.cjs` and `electron/preload.cjs` are included. The main process:

1. Spawns the standalone Next.js server on `127.0.0.1:3658`.
2. Sets `SHEETSNAP_DATA_DIR` to `app.getPath("userData")` so job history and
   artifacts live in the OS user-data folder — **not** the install directory:
   - Windows: `%APPDATA%/SheetSnap`
   - macOS: `~/Library/Application Support/SheetSnap`
   - Linux: `~/.config/SheetSnap`
3. Waits for the port, then opens a `BrowserWindow` on it.
4. Kills the server when the window closes.

### 2. Produce the standalone server

`output: "standalone"` is already set in `next.config.ts`. A single command
builds and finalizes it (copies static assets in):

```bash
npm run build
# → .next/standalone is now fully self-runnable via: node .next/standalone/server.js
```

Assemble the Electron resources (CI-friendly):

```bash
mkdir -p dist-resources
cp -r .next/standalone dist-resources/server
```

### 3. Native dependencies & bundled tools

- **sharp** — run `npx @electron/rebuild` after install so libvips matches
  Electron's ABI.
- **ffmpeg-static** — automatically downloads the correct per-platform ffmpeg
  when you `npm install` on each target OS (or in per-OS CI jobs). It is a
  normal dependency, so it rides along inside the server bundle.
- **yt-dlp** — download the official binary per platform into
  `resources/bin/yt-dlp[.exe]`, add it via builder `extraResources`, and set
  `YTDLP_PATH` to that location in `main.cjs` (already wired). If yt-dlp is
  absent, only the YouTube tab degrades — uploads still work.

### 4. Install dependencies and build installers

```bash
npm i -D electron electron-builder @electron/rebuild
npx @electron/rebuild
npx electron-builder --win --mac --linux   # one per-OS CI job each
```

Builder configuration (add to `package.json`):

```json
{
  "main": "electron/main.cjs",
  "build": {
    "appId": "app.sheetsnap.desktop",
    "productName": "SheetSnap",
    "files": ["electron/**"],
    "extraResources": [
      { "from": "dist-resources/server", "to": "server" },
      { "from": "resources/bin", "to": "bin" }
    ],
    "win": { "target": ["nsis"] },
    "mac": { "target": ["dmg"], "category": "public.app-category.utilities" },
    "linux": { "target": ["AppImage", "deb"] }
  }
}
```

Result: `SheetSnap Setup x.y.z.exe`, `SheetSnap-x.y.z.dmg`,
`SheetSnap-x.y.z.AppImage` — the double-click experience, with job history
persisted in the user's own data folder across launches and upgrades.

## Alternative: Tauri 2

If bundle size matters more than build simplicity: export the UI statically
(`output: "export"`) and port `src/server/*` to a Tauri sidecar (the same
Node server spawned by Rust, or a Rust rewrite of the pipeline — the numeric
kernels are deliberately dependency-free to make that easy). Electron remains
the lower-friction path for 2026 because nothing in this repo needs to change.
