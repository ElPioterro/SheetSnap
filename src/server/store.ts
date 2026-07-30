import fs from "node:fs";
import path from "node:path";
import type { JobStatus, SourceType, StoredJob } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { JOBS_DIR, ensureDir, jobDir } from "./config";

/**
 * Filesystem persistence layer.
 *
 * Each job is a folder:  data/jobs/<uuid>/
 *   job.json        — the durable job record (status, meta, params, result)
 *   video.<ext>     — the source video (upload or yt-dlp download)
 *   preview.jpg     — frame used for crop selection
 *   lines/NNNN.png  — extracted sheet-music lines
 *   result.pdf      — assembled A4 PDF
 *   result.zip      — PNG archive
 *
 * job.json is written atomically (temp file + rename), so a crash mid-write
 * can never corrupt a record. History across restarts is just the set of
 * folders on disk — no database, no migrations, no setup.
 */

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertJobId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new ApiError(404, "NOT_FOUND", "Project not found.");
  }
}

function jobFile(id: string): string {
  return path.join(jobDir(id), "job.json");
}

export function loadJob(id: string): StoredJob {
  assertJobId(id);
  try {
    return JSON.parse(fs.readFileSync(jobFile(id), "utf8")) as StoredJob;
  } catch {
    throw new ApiError(404, "NOT_FOUND", "Project not found.");
  }
}

/** Atomic write: temp file in the same directory, then rename over. */
export function saveJob(job: StoredJob): void {
  ensureDir(jobDir(job.id));
  const file = jobFile(job.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, file);
}

export function createJobRecord(partial: {
  id?: string;
  title: string;
  sourceType: SourceType;
  sourceUrl?: string | null;
  status?: JobStatus;
}): StoredJob {
  const now = new Date().toISOString();
  const job: StoredJob = {
    id: partial.id ?? crypto.randomUUID(),
    title: partial.title,
    sourceType: partial.sourceType,
    sourceUrl: partial.sourceUrl ?? null,
    status: partial.status ?? "preparing",
    createdAt: now,
    updatedAt: now,
    meta: null,
    params: null,
    result: null,
    error: null,
  };
  saveJob(job);
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Omit<StoredJob, "id" | "createdAt">>,
): StoredJob {
  const current = loadJob(id);
  const next: StoredJob = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  saveJob(next);
  return next;
}

/** Scan the jobs directory; skip anything that isn't a valid job folder. */
export function listStoredJobs(): StoredJob[] {
  ensureDir(JOBS_DIR);
  const out: StoredJob[] = [];
  for (const entry of fs.readdirSync(JOBS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    try {
      const job = JSON.parse(
        fs.readFileSync(path.join(JOBS_DIR, entry.name, "job.json"), "utf8"),
      ) as StoredJob;
      if (job && typeof job.id === "string") out.push(job);
    } catch {
      /* skip corrupt/incomplete folders — never let one break the list */
    }
  }
  return out
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
}

const VIDEO_FILENAMES = [
  "video.mp4",
  "video.mkv",
  "video.webm",
  "video.mov",
  "video.m4v",
  "video.avi",
];

/** Locate the source video inside a job folder (uploaded or downloaded). */
export function findVideoFile(id: string): string | null {
  const dir = jobDir(id);
  try {
    for (const name of VIDEO_FILENAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* directory gone */
  }
  return null;
}
