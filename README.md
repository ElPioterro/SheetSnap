# SheetSnap

**Turn music videos into printable sheet music — line by line.**
Upload a piano/tutorial video or paste a YouTube link, drag a crop rectangle
over the sheet music, and SheetSnap extracts every unique staff line into a
print-ready A4 PDF and a ZIP of PNGs.

Everything runs locally. **No database, no cloud, no Python, no terminal.**

---

## Why this stack (2026)

| Concern | Choice | Why |
| --- | --- | --- |
| Frontend | **Next.js 16 (App Router) + React 19 + Tailwind v4** | One codebase serves the browser today and wraps into a desktop shell (Electron) tomorrow without a rewrite. |
| Backend | **Next.js Route Handlers (Node 22, TypeScript)** instead of FastAPI | A single runtime for UI + API means the desktop build ships **one** binary — no Python interpreter to embed, no PyInstaller/OpenCV/ffmpeg bundling fragility (the classic failure mode of Python desktop apps). |
| Persistence | **Filesystem (`data/jobs/<id>/job.json` + artifacts)** | Zero external services, zero migrations, zero native modules. Job history survives restarts as plain folders on disk. See "Why filesystem, not SQLite" below. |
| Video | **ffmpeg-static** (bundled ffmpeg 7, per-platform binaries via npm) | Seeking, cropping, frame sampling, and decoding all happen in ffmpeg. Deterministic, fast, zero GUI dependencies. |
| Image pipeline | **TypeScript integer kernels + sharp (libvips)** | Otsu binarization, NCC grouping, and AND-merging are ~40 lines of allocation-free loops — faster than calling OpenCV per frame. |
| PDF | **pdf-lib** | Pure JS, embeds PNGs without compression loss, works identically everywhere. |
| YouTube | **yt-dlp binary** (optional) | The maintained, standard tool; bundled as a resource in desktop builds. Missing it only disables the YouTube tab — uploads still work. |
| Desktop | **Electron + electron-builder** (see `PACKAGING.md`) | The app already IS Node — packaging is "wrap the server + this UI", giving true double-click installers for Windows/macOS/Linux. |

## Quick start (local development)

That's it — no database, no `.env`, no external services.

```bash
npm install
npm run dev
# open http://localhost:3000
```

`ffmpeg-static` downloads a per-platform ffmpeg binary during `npm install`.
Optional: `node scripts/make-sample-video.mjs` generates a synthetic
scrolling-staff video to feed through the whole flow.

### Production (standalone server)

```bash
npm run build   # next build, then postbuild finalizes .next/standalone
npm start       # node .next/standalone/server.js  →  http://localhost:3000
```

The `postbuild` hook copies static assets into `.next/standalone`, so
`node .next/standalone/server.js` is fully self-runnable — this is the exact
same command the packaged desktop app launches.

### YouTube support

- **Packaged desktop app:** yt-dlp is bundled and the YouTube tab just works.
- **Local development:** if yt-dlp isn't on your `PATH`, the YouTube tab shows
  a clear error, and local file upload keeps working. Install yt-dlp or set
  `YTDLP_PATH` in a `.env` file (see `.env.example`).

## Why filesystem, not SQLite

The app is a single-user local desktop tool. The heavy data (source video,
PNGs, PDF, ZIP) is *already* files; the only structured data is a ~2 KB job
record. So persistence is a folder per job:

```
data/jobs/<uuid>/
  job.json        # status, meta, crop/settings, result   (atomic tmp+rename writes)
  video.mp4       # uploaded or downloaded source
  preview.jpg     # frame used for crop selection
  lines/0000.png  # extracted staff lines
  result.pdf      # assembled A4 PDF
  result.zip      # PNG archive
```

Compared to SQLite this means: **no native module to compile/rebuild per
Electron ABI**, no schema to migrate, no driver to bundle, no WAL/lock
surprises — and a crash mid-write can't corrupt a record because `job.json` is
written to a temp file and renamed over the old one. History across restarts
is just "the folders that exist". A user can even copy/backup the data folder
directly. With one process running one heavy job at a time, there is no
concurrency argument for a DB.

In packaged builds the folder is redirected to the OS user-data location via
`SHEETSNAP_DATA_DIR` (set by Electron) — never inside the install directory.

## The pipeline (port of the original Python script)

`samples → crop → binarize → group → merge → PDF`, identical in spirit to the
original OpenCV version:

| Original (OpenCV/fpdf) | Here (ffmpeg/TS) |
| --- | --- |
| `yt_dlp` download | `src/server/downloader.ts` |
| `cap.set(CAP_PROP_POS_MSEC)` start time | output-level `-ss` (frame-accurate) |
| `frame_count % FRAME_SKIP` | ffmpeg `select=not(mod(n\,K))` |
| `frame[y1:y2, x1:x2]` ROI | ffmpeg `crop=` filter |
| `cvtColor` + `threshold(OTSU)` | `rgbToGray` + `otsuThreshold` (`pipeline.ts`) |
| `matchTemplate(TM_CCOEFF_NORMED)` grouping | normalized cross-correlation on a 160×N descriptor grid (same metric, ~100× cheaper) |
| `bitwise_and` group merge | running AND-accumulator (associative → identical output) |
| `FPDF` A4 layout | `pdf-lib` (`pdf.ts`) — same margins/gaps/title |

Improvements over the original: near-blank frames are skipped instead of
forming junk groups, and extracted lines can be deleted individually with the
PDF/ZIP rebuilt automatically.

## Architecture

```
src/
├── components/            # UI (client)
│   ├── app.tsx            # 4-step wizard shell + polling state machine
│   ├── source-step.tsx    #   1. upload (drag&drop, XHR progress) / YouTube
│   ├── crop-selector.tsx  #   2. drag-to-select rectangle (8 handles, arrows, dbl-click)
│   ├── crop-step.tsx      #   2. crop + manual X/Y/W/H + pipeline settings
│   ├── processing-step.tsx#   3. live progress, stats, log console, cancel
│   ├── results-step.tsx   #   4. line gallery, lightbox, delete, PDF/ZIP export
│   └── ui.tsx             #   minimal design system (neutral + one accent)
├── server/                # backend modules (separation of concerns)
│   ├── config.ts          # data dir, upload cap, path helpers (env-driven)
│   ├── store.ts           # filesystem persistence (job.json, atomic writes)
│   ├── ffmpeg.ts          # video handling: probe, preview frame, frame sampler
│   ├── pipeline.ts        # extraction pipeline: Otsu, NCC grouping, merging
│   ├── downloader.ts      # yt-dlp integration
│   ├── pdf.ts             # A4 PDF assembly
│   ├── jobs.ts            # job orchestration, validation, artifacts
│   └── http.ts            # uniform API error shape
└── app/api/               # thin HTTP layer
    ├── source/upload      # PUT, streamed to disk (constant memory)
    ├── source/youtube     # POST, background download
    └── jobs/[id]/*        # status / process / cancel / lines / artifact files
```

Design notes:

- **One heavy job at a time** (local desktop semantics) with structured
  `ApiError`s (`{error:{code,message}}`) surfaced as readable UI messages.
- **Live progress/logs** are polled every 800ms — no websockets to manage.
- Artifacts are served via a strict allow-listed file route; nothing outside
  the whitelist (`preview.jpg`, `result.pdf`, `result.zip`, `lines/NNNN.png`)
  can be read.

## Environment variables (all optional)

See `.env.example`. Defaults work out of the box.

| Var | Default | Purpose |
| --- | --- | --- |
| `SHEETSNAP_DATA_DIR` | `./data` (desktop: OS user-data folder) | Where job history + artifacts live |
| `FFMPEG_PATH` | bundled ffmpeg-static | override the ffmpeg binary |
| `YTDLP_PATH` | `yt-dlp` on PATH | override the yt-dlp binary |
| `MAX_UPLOAD_MB` | `2048` | upload size cap |

## Packaging into a desktop app

See **`PACKAGING.md`** — Electron builder configs plus the trade-offs vs.
Tauri, and how ffmpeg/yt-dlp are bundled and data is redirected to the OS
user-data folder so users just double-click.
