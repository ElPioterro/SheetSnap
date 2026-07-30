/**
 * Generates a synthetic scrolling "sheet music" test video:
 *   8 unique staff lines, each held ~2.2s with a short scroll transition —
 *   exactly the situation the extraction pipeline is built for.
 *
 * Usage: node scripts/make-sample-video.mjs [out.mp4]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const sharp = require("sharp");

const W = 960;
const H = 540;
const FPS = 24;
const LINES = 8;
const HOLD = 53; // frames each line stands still
const SCROLL = 11; // transition frames
const GAP = 200; // scroll distance
const STAFF_Y = 250;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lineGroup(li, offY) {
  const rnd = mulberry32(1000 + li * 77);
  const y0 = STAFF_Y;
  let s = `<g transform="translate(0 ${offY.toFixed(2)})">`;
  for (let i = 0; i < 5; i++) {
    s += `<rect x="60" y="${y0 + i * 14}" width="840" height="2" fill="#141414"/>`;
  }
  s += `<rect x="60" y="${y0}" width="2.5" height="56" fill="#141414"/>`;
  s += `<rect x="897.5" y="${y0}" width="2.5" height="56" fill="#141414"/>`;
  const notes = 10 + (li % 5);
  for (let k = 0; k < notes; k++) {
    const nx = 92 + (k * 780) / notes + rnd() * 24;
    const ny = y0 - 10 + rnd() * 76;
    s += `<ellipse cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" rx="6" ry="4.4" fill="#141414" transform="rotate(-18 ${nx.toFixed(1)} ${ny.toFixed(1)})"/>`;
    if (ny < y0 + 28) {
      s += `<rect x="${(nx + 5.2).toFixed(1)}" y="${(ny - 33).toFixed(1)}" width="1.5" height="33" fill="#141414"/>`;
    } else {
      s += `<rect x="${(nx - 6.7).toFixed(1)}" y="${ny.toFixed(1)}" width="1.5" height="33" fill="#141414"/>`;
    }
    if (ny < y0 - 14 || ny > y0 + 70) {
      s += `<rect x="${(nx - 10).toFixed(1)}" y="${(Math.round(ny / 14) * 14).toFixed(1)}" width="18" height="1.6" fill="#141414"/>`;
    }
  }
  return s + "</g>";
}

function frameSvg(spec) {
  let inner = "";
  if (spec.type === "hold") inner = lineGroup(spec.line, 0);
  else
    inner =
      lineGroup(spec.a, -spec.t * GAP) + lineGroup(spec.b, GAP - spec.t * GAP);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${inner}</svg>`;
}

async function main() {
  const out = process.argv[2] ?? path.join("data", "samples", "scrolling-staff.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const specs = [];
  for (let li = 0; li < LINES; li++) {
    for (let f = 0; f < HOLD; f++) specs.push({ type: "hold", line: li });
    if (li < LINES - 1)
      for (let f = 0; f < SCROLL; f++)
        specs.push({ type: "scroll", a: li, b: li + 1, t: (f + 1) / (SCROLL + 1) });
  }

  const child = spawn(
    ffmpegPath,
    [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      out,
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  const closed = once(child, "close");

  for (let i = 0; i < specs.length; i++) {
    const png = await sharp(Buffer.from(frameSvg(specs[i]))).png().toBuffer();
    if (!child.stdin.write(png)) await once(child.stdin, "drain");
    if (i % 60 === 0) process.stdout.write(`\rrendering frame ${i}/${specs.length}`);
  }
  child.stdin.end();
  const [code] = await closed;
  if (code !== 0) {
    console.error(`\nffmpeg exited with ${code}`);
    process.exit(1);
  }
  console.log(
    `\nDone: ${out} — ${LINES} unique lines, ${specs.length} frames (${(specs.length / FPS).toFixed(1)}s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
