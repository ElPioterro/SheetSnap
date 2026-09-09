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

- **sharp** — **no rebuild needed.** sharp ≥ 0.33 ships its native binary as a
  per-platform **N-API** prebuild (`@img/sharp-<platform>`). N-API is
  ABI-stable across Node *and* Electron, so the same binary that `npm install`
  fetches runs unchanged under the packaged Electron process. (Older guides
  tell you to run `@electron/rebuild` for sharp; that is obsolete here and is
  deliberately *not* wired in.)
- **ffmpeg-static** — automatically downloads the correct per-platform ffmpeg
  when you `npm install` **on each target OS** (or in per-OS CI jobs). It is a
  normal dependency, so it rides along inside the server bundle. Note: a
  Windows `npm install` only fetches `ffmpeg.exe`; you cannot produce a working
  macOS app from a Windows checkout (see "Building for both platforms" below).
- **yt-dlp** — download the official binary per platform into
  `resources/bin/yt-dlp[.exe]`, add it via builder `extraResources`, and set
  `YTDLP_PATH` to that location in `main.cjs` (already wired). If yt-dlp is
  absent, only the YouTube tab degrades — uploads still work. See
  `resources/bin/README.md`.

### 4. Build installers

The Electron toolchain and builder config are already wired into
`package.json`. Install once, then build:

```bash
npm install                 # electron + electron-builder come with it
npm run dist:win            # → dist/SheetSnap Setup <version>.exe
# or, on the respective OS:
#   npm run dist             # current OS's default target
#   npx electron-builder --mac      (must run on macOS)
#   npx electron-builder --linux
```

`npm run dist:win` runs three steps in order (see `scripts`):

1. `next build` + `postbuild` → finalizes `.next/standalone`.
2. `scripts/assemble-resources.mjs` → stages it into `dist-resources/server`
   (dereferencing symlinks, and asserting ffmpeg + sharp actually made it into
   the bundle — a guard against silent trace-pruning failures).
3. `electron-builder --win` → wraps it into an NSIS installer.

Result: `dist\SheetSnap Setup x.y.z.exe` (and `SheetSnap-x.y.z.dmg` /
`SheetSnap-x.y.z.AppImage` from the mac/linux jobs) — the double-click
experience, with job history persisted in the user's own data folder across
launches and upgrades.

### Building for both platforms

There is no cross-compilation here: **build each OS's installer on that OS.**

- `ffmpeg-static` only downloads the current platform's ffmpeg at install time.
- `electron-builder` cannot produce a macOS `.dmg` from Windows (and vice
  versa) — the code-signing/packaging tools are OS-native.

The clean path to shipping Windows **and** macOS from one push is CI with a
build matrix (e.g. GitHub Actions running `windows-latest` + `macos-latest`
jobs, each doing `npm ci && npm run dist:<os>` and uploading the artifact).

### Windows gotcha: winCodeSign symlink extraction

On its first run, electron-builder downloads a `winCodeSign` bundle that
contains macOS `.dylib` **symlinks**. Creating symlinks on Windows requires
**Developer Mode** (Settings → Privacy & security → For developers) or an
elevated shell; without it, extraction fails with
`Cannot create symbolic link … the client does not have the required
privileges`, and the build stops after `dist/win-unpacked` with no installer.
Enabling Developer Mode once fixes it permanently. (Those dylibs are macOS-only
and unused by the Windows build.)

## Alternative: Tauri 2

If bundle size matters more than build simplicity: export the UI statically
(`output: "export"`) and port `src/server/*` to a Tauri sidecar (the same
Node server spawned by Rust, or a Rust rewrite of the pipeline — the numeric
kernels are deliberately dependency-free to make that easy). Electron remains
the lower-friction path for 2026 because nothing in this repo needs to change.
