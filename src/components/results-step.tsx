"use client";

import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JobDTO } from "@/lib/types";
import {
  ApiClientError,
  deleteLine,
  jobFileUrl,
  rebuildJobArtifacts,
} from "@/lib/api-client";
import { fmtElapsed } from "@/lib/format";
import { Alert, Button, Card, Chip, Modal, buttonStyles, cn } from "./ui";

export function ResultsStep({
  job,
  onJob,
  onAdjust,
  onNew,
}: {
  job: JobDTO;
  onJob: (j: JobDTO) => void;
  onAdjust: () => void;
  onNew: () => void;
}) {
  const result = job.result;
  const params = job.params;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const imageCount = result?.images.length ?? 0;

  // Deleting a line is instant server-side; the PDF/ZIP refresh is deferred
  // to a background request, debounced so a burst of deletions only triggers
  // one rebuild once the user pauses.
  const scheduleRebuild = () => {
    if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
    setRefreshing(true);
    rebuildTimer.current = setTimeout(async () => {
      try {
        await rebuildJobArtifacts(job.id);
      } catch {
        // Non-fatal: downloads stay as they were until the next rebuild.
      } finally {
        setRefreshing(false);
      }
    }, 700);
  };

  useEffect(
    () => () => {
      if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
    },
    [],
  );

  const handleDelete = async (name: string) => {
    if (deleting) return;
    const label = name.split("/")[1];
    // Delete immediately on click — no confirmation dialog.
    setDeleting(name);
    setError(null);
    try {
      const updated = await deleteLine(job.id, label);
      onJob(updated);
      scheduleRebuild();
      if (
        lightbox !== null &&
        updated.result &&
        lightbox >= updated.result.images.length
      ) {
        setLightbox(
          updated.result.images.length > 0
            ? updated.result.images.length - 1
            : null,
        );
      }
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Could not remove that line.",
      );
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    if (lightbox === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight")
        setLightbox((i) =>
          i === null ? i : Math.min(imageCount - 1, i + 1),
        );
      else if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox, imageCount]);

  if (!result) return null;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {result.lineCount} line{result.lineCount === 1 ? "" : "s"} extracted
            </h2>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              Sampled{" "}
              <span className="font-mono tabular-nums">
                {result.framesSampled.toLocaleString()}
              </span>{" "}
              frames in {fmtElapsed(result.elapsedMs)} · {job.title}
            </p>
            {params && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Chip>
                  crop {params.crop.width}×{params.crop.height}
                </Chip>
                <Chip>every {params.frameSkip} frames</Chip>
                <Chip>similarity ≥ {params.similarityThreshold.toFixed(3)}</Chip>
                {params.startTime > 0 && <Chip>from {params.startTime}s</Chip>}
                <Chip tone={params.bw ? "blue" : "zinc"}>
                  {params.bw ? "B&W merge" : "color"}
                </Chip>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {refreshing && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <Loader2 className="size-3 animate-spin" />
              Refreshing exports…
            </span>
          )}
          <a
            href={jobFileUrl(job.id, "result.pdf", true)}
            download
            className={buttonStyles("primary")}
          >
            <FileDown className="size-4" />
            Download PDF
          </a>
          <a
            href={jobFileUrl(job.id, "result.zip", true)}
            download
            className={buttonStyles("secondary")}
          >
            <Archive className="size-4" />
            PNGs (ZIP)
          </a>
          <Button variant="ghost" onClick={onAdjust}>
            <SlidersHorizontal className="size-4" />
            Adjust &amp; rerun
          </Button>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {result.images.map((img, i) => (
          <Card key={img.name} className="anim-fade overflow-hidden">
            <button
              onClick={() => setLightbox(i)}
              className="group relative block w-full border-b border-zinc-100 bg-white p-3 focus-visible:outline-2 focus-visible:outline-blue-600"
              aria-label={`Open line ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={jobFileUrl(job.id, img.name)}
                alt={`Sheet music line ${i + 1}`}
                loading="lazy"
                className="mx-auto max-h-56 w-full object-contain transition-opacity group-hover:opacity-90"
              />
              <span className="absolute left-3 top-3 rounded-md bg-zinc-900/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
            </button>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                {img.name.split("/")[1]} · {img.width}×{img.height}
              </span>
              <div className="flex items-center gap-0.5">
                <a
                  href={jobFileUrl(job.id, img.name, true)}
                  download
                  aria-label={`Download line ${i + 1}`}
                  className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                >
                  <Download className="size-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(img.name)}
                  disabled={deleting === img.name || imageCount <= 1}
                  aria-label={`Remove line ${i + 1} from project`}
                  title={
                    imageCount <= 1
                      ? "Cannot remove the last line"
                      : "Remove this line"
                  }
                  className={cn(
                    "rounded-md p-1.5 transition-colors",
                    deleting === img.name
                      ? "text-zinc-400"
                      : "text-zinc-400 hover:bg-red-50 hover:text-red-600",
                  )}
                >
                  {deleting === img.name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-center pt-1">
        <Button variant="ghost" onClick={onNew}>
          <RotateCcw className="size-4" />
          Start a new project
        </Button>
      </div>

      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        className="w-full max-w-4xl p-5"
      >
        {lightbox !== null && result.images[lightbox] && (
          <div>
            <div className="mb-3 flex items-center justify-between pr-8">
              <p className="text-[13px] font-medium text-zinc-700">
                Line {lightbox + 1} of {imageCount}
              </p>
              <a
                href={jobFileUrl(job.id, result.images[lightbox].name, true)}
                download
                className={buttonStyles("secondary", "sm")}
              >
                <Download className="size-3.5" />
                Download
              </a>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setLightbox((i) => Math.max(0, (i ?? 0) - 1))}
                disabled={lightbox === 0}
                aria-label="Previous line"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={jobFileUrl(job.id, result.images[lightbox].name)}
                alt={`Sheet music line ${lightbox + 1}`}
                className="max-h-[68vh] w-full min-w-0 object-contain"
              />
              <button
                onClick={() =>
                  setLightbox((i) => Math.min(imageCount - 1, (i ?? 0) + 1))
                }
                disabled={lightbox === imageCount - 1}
                aria-label="Next line"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <p
              className={cn(
                "mt-3 text-center font-mono text-[11px] text-zinc-400",
              )}
            >
              Use ← → to move between lines
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
