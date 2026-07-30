// Shared domain types for the whole application (used by server + client).

export type JobStatus =
  | "preparing" // source is being downloaded / probed
  | "pending" // source ready, waiting for crop selection
  | "processing" // extraction pipeline running
  | "done" // artifacts ready
  | "error"
  | "canceled";

export type SourceType = "upload" | "youtube";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessParams {
  crop: CropRect;
  /** Analyze every Nth frame. */
  frameSkip: number;
  /** Normalized cross-correlation threshold, 0..1. */
  similarityThreshold: number;
  /** Threshold each line to black & white and bitwise-AND duplicates for crisp output. */
  bw: boolean;
  /** Seconds of the video to skip at the start (e.g. to skip an intro). */
  startTime: number;
  /** Title printed on the PDF's first page. */
  title: string;
  /**
   * Offset added to the auto (Otsu) threshold, −40..+40. Positive values
   * bias toward white (cleaner background, may drop faint marks); negative
   * values keep more dark pixels (better for blurry / low-contrast sources).
   */
  thresholdBias: number;
  /**
   * Rows to trim from the *top* of every extracted line image after the
   * merge step. Removes the black-border/previous-line residue that
   * scrolling notation software often leaves at the top edge.
   */
  topTrim: number;
}

export const DEFAULT_SETTINGS = {
  frameSkip: 30,
  similarityThreshold: 0.95,
  bw: true,
  startTime: 0,
  thresholdBias: 0,
  topTrim: 3,
} as const;

/**
 * One-click presets for the image processing settings. `"custom"` is the
 * synthetic state used when the user has tweaked any control away from a
 * preset's exact values.
 */
export type ImagePreset = "clean" | "soft" | "custom";

export interface PresetDef {
  key: Exclude<ImagePreset, "custom">;
  label: string;
  description: string;
  similarityThreshold: number;
  thresholdBias: number;
  bw: true;
}

export const IMAGE_PRESETS: readonly PresetDef[] = [
  {
    key: "clean",
    label: "Clean B&W",
    description:
      "High contrast · strict grouping. Best for crisp digital sheet music on a solid white background.",
    similarityThreshold: 0.97,
    thresholdBias: 12,
    bw: true,
  },
  {
    key: "soft",
    label: "Soft B&W",
    description:
      "Lower contrast · lenient grouping. Best for filmed, compressed, or slightly blurry sources.",
    similarityThreshold: 0.92,
    thresholdBias: -14,
    bw: true,
  },
];

/** Which preset (if any) matches the given values exactly? */
export function detectPreset(
  similarity: number,
  thresholdBias: number,
  bw: boolean,
): ImagePreset {
  for (const p of IMAGE_PRESETS) {
    if (
      p.bw === bw &&
      Math.abs(p.similarityThreshold - similarity) < 1e-4 &&
      p.thresholdBias === thresholdBias
    ) {
      return p.key;
    }
  }
  return "custom";
}

export interface JobMeta {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  frameCount: number;
}

export interface ResultImage {
  /** Path relative to the job directory, e.g. "lines/0000.png". */
  name: string;
  width: number;
  height: number;
}

export interface JobResult {
  lineCount: number;
  framesSampled: number;
  elapsedMs: number;
  images: ResultImage[];
}

/**
 * The durable job record, persisted as data/jobs/<id>/job.json.
 * Matches the client-facing DTO one-to-one, minus live progress.
 */
export interface StoredJob {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  status: JobStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  meta: JobMeta | null;
  params: ProcessParams | null;
  result: JobResult | null;
  error: string | null;
}

/** Live, in-memory progress of a running job (merged into the DTO on reads). */
export interface JobLive {
  phase: string;
  percent: number; // 0..1
  framesSampled: number;
  linesFound: number;
  logs: string[];
  cancelRequested: boolean;
}

export interface JobDTO {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  status: JobStatus;
  createdAt: string;
  meta: JobMeta | null;
  params: ProcessParams | null;
  result: JobResult | null;
  error: string | null;
  live: JobLive | null;
}

/** Error with an HTTP status + machine-readable code for API responses. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the user cancels a running job — not a failure. */
export class CancelledError extends Error {
  constructor() {
    super("The job was canceled.");
    this.name = "CancelledError";
  }
}
