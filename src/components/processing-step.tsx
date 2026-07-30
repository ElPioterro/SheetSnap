"use client";

import { ArrowLeft, Ban, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JobDTO } from "@/lib/types";
import { ApiClientError, cancelJob } from "@/lib/api-client";
import { Alert, Button, Card, Progress, Spinner } from "./ui";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-medium leading-none text-zinc-900 tabular-nums">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[10px] text-zinc-400 tabular-nums">{hint}</p>
      )}
    </div>
  );
}

export function ProcessingStep({
  job,
  onRetry,
  onRestart,
}: {
  job: JobDTO;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const running = job.status === "processing" || job.status === "preparing";

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const t = setInterval(
      () => setElapsed((Date.now() - startRef.current) / 1000),
      500,
    );
    return () => clearInterval(t);
  }, [job.id]);

  const logs = job.live?.logs ?? [];
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const cancel = async () => {
    if (canceling) return;
    setCanceling(true);
    setCancelError(null);
    try {
      await cancelJob(job.id);
    } catch (e) {
      setCancelError(
        e instanceof ApiClientError ? e.message : "Could not cancel the job.",
      );
    } finally {
      setCanceling(false);
    }
  };

  const live = job.live;
  const percent = live?.percent ?? 0;
  const sampled = live?.framesSampled ?? 0;
  const lines = live?.linesFound ?? 0;
  const rate = running && elapsed > 1 && sampled > 0 ? sampled / elapsed : null;

  if (job.status === "error" || job.status === "canceled") {
    return (
      <div className="flex flex-col gap-5">
        <Card className="p-6">
          <Alert
            tone={job.status === "error" ? "error" : "warn"}
            title={
              job.status === "error"
                ? "Processing failed"
                : "Processing was canceled"
            }
          />
          {job.error && (
            <p className="mt-3 rounded-lg bg-zinc-50 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-zinc-700">
              {job.error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {job.meta && (
              <Button variant="primary" onClick={onRetry}>
                <SlidersHorizontal className="size-4" />
                Adjust settings &amp; retry
              </Button>
            )}
            <Button variant="ghost" onClick={onRestart}>
              <RotateCcw className="size-4" />
              Start over
            </Button>
          </div>
        </Card>
        {logs.length > 0 && (
          <div
            ref={logRef}
            className="log-scroll max-h-56 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-[11.5px] leading-[1.75] text-zinc-300"
          >
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Spinner className="size-5 text-blue-600" />
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">
                {job.status === "preparing"
                  ? "Fetching video"
                  : "Extracting sheet music"}
              </h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                {live?.phase ?? "Working…"}
              </p>
            </div>
          </div>
          <span className="font-mono text-2xl font-medium text-zinc-900 tabular-nums">
            {Math.round(percent * 100)}
            <span className="text-sm text-zinc-400">%</span>
          </span>
        </div>
        <Progress value={percent} className="mt-4" />
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Frames sampled" value={sampled.toLocaleString()} />
        <Stat label="Lines found" value={String(lines)} />
        <Stat
          label="Elapsed"
          value={`${elapsed.toFixed(1)}s`}
          hint={rate ? `${rate.toFixed(1)} samples/s` : undefined}
        />
        <Stat
          label="Mode"
          value={job.params?.bw === false ? "Color" : "B&W"}
          hint={
            job.params ? `every ${job.params.frameSkip} frames` : undefined
          }
        />
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
          Activity log
        </p>
        <div
          ref={logRef}
          className="log-scroll h-56 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-[11.5px] leading-[1.75] text-zinc-300"
          aria-live="polite"
        >
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>

      {cancelError && <Alert tone="error">{cancelError}</Alert>}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onRestart}>
          <ArrowLeft className="size-4" />
          Leave this project
        </Button>
        <Button
          variant="danger"
          onClick={cancel}
          loading={canceling}
          // boolean | undefined only — never null (hydration consistency).
          disabled={live?.cancelRequested ? true : undefined}
        >
          <Ban className="size-4" />
          {live?.cancelRequested ? "Canceling…" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
