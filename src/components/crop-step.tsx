"use client";

import {
  ArrowLeft,
  Check,
  Maximize2,
  Play,
  Shrink,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type {
  CropRect,
  ImagePreset,
  JobDTO,
  JobMeta,
  ProcessParams,
} from "@/lib/types";
import { DEFAULT_SETTINGS, IMAGE_PRESETS, detectPreset } from "@/lib/types";
import { ApiClientError, jobFileUrl, startProcessing } from "@/lib/api-client";
import { fmtSeconds } from "@/lib/format";
import {
  Alert,
  Button,
  Card,
  Field,
  NumberField,
  Switch,
  cn,
  inputCls,
} from "./ui";
import { CropSelector, clampRect } from "./crop-selector";

function insetDefault(meta: JobMeta): CropRect {
  const ix = Math.round(meta.width * 0.06);
  const iy = Math.round(meta.height * 0.06);
  return {
    x: ix,
    y: iy,
    width: meta.width - 2 * ix,
    height: meta.height - 2 * iy,
  };
}

export function CropStep({
  job,
  onBack,
  onStarted,
}: {
  job: JobDTO;
  onBack: () => void;
  onStarted: (job: JobDTO) => void;
}) {
  const meta = job.meta!;
  const [crop, setCropState] = useState<CropRect>(
    () => job.params?.crop ?? insetDefault(meta),
  );
  const [title, setTitle] = useState(job.params?.title ?? job.title);
  const [startTime, setStartTime] = useState(
    job.params?.startTime ?? DEFAULT_SETTINGS.startTime,
  );
  const [frameSkip, setFrameSkip] = useState(
    job.params?.frameSkip ?? DEFAULT_SETTINGS.frameSkip,
  );
  const [similarity, setSimilarity] = useState(
    job.params?.similarityThreshold ?? DEFAULT_SETTINGS.similarityThreshold,
  );
  const [bw, setBw] = useState(job.params?.bw ?? DEFAULT_SETTINGS.bw);
  const [thresholdBias, setThresholdBias] = useState(
    job.params?.thresholdBias ?? DEFAULT_SETTINGS.thresholdBias,
  );
  const [topTrim, setTopTrim] = useState(
    job.params?.topTrim ?? DEFAULT_SETTINGS.topTrim,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived: which preset (if any) exactly matches the current values?
  // No local mirror state — the buttons are highlighted purely off the
  // real values, so any manual slider tweak automatically clears the
  // selection (there's nothing that could get out of sync).
  const activePreset: ImagePreset = detectPreset(similarity, thresholdBias, bw);

  const setCrop = (r: CropRect) =>
    setCropState(clampRect(r, meta.width, meta.height, 16));

  const applyPreset = (key: Exclude<ImagePreset, "custom">) => {
    const p = IMAGE_PRESETS.find((x) => x.key === key)!;
    setSimilarity(p.similarityThreshold);
    setThresholdBias(p.thresholdBias);
    setBw(p.bw);
  };

  const invalid = crop.width < 16 || crop.height < 16;

  const start = async () => {
    if (busy || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const params: ProcessParams = {
        crop,
        frameSkip,
        similarityThreshold: similarity,
        bw,
        startTime,
        title: title.trim() || job.title,
        thresholdBias,
        topTrim,
      };
      const j = await startProcessing(job.id, params);
      onStarted(j);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Could not start processing.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-medium text-zinc-700">{job.title}</span>
            <span className="text-zinc-300">|</span>
            <span className="font-mono text-zinc-500 tabular-nums">
              {meta.width}×{meta.height} · {fmtSeconds(meta.duration)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setCrop({ x: 0, y: 0, width: meta.width, height: meta.height })
              }
            >
              <Maximize2 className="size-3.5" />
              Full frame
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCrop(insetDefault(meta))}
            >
              <Shrink className="size-3.5" />
              Default inset
            </Button>
          </div>
        </div>
        <div className="p-4">
          <CropSelector
            src={jobFileUrl(job.id, "preview.jpg")}
            naturalWidth={meta.width}
            naturalHeight={meta.height}
            value={crop}
            onChange={setCrop}
          />
          <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-400">
            Drag on the frame to select exactly where the sheet music appears —
            cutting out the performer and background makes detection far more
            accurate. Drag inside the selection to move it, use the handles to
            resize, or type exact pixels on the right. Double-click fills the
            frame; arrow keys nudge by one pixel (Shift for ten).
          </p>
        </div>
      </Card>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card className="p-5">
          <h3 className="text-[13px] font-semibold text-zinc-800">
            Crop region
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField
              label="X"
              value={crop.x}
              min={0}
              max={meta.width - 16}
              suffix="px"
              onChange={(v) => setCrop({ ...crop, x: v })}
            />
            <NumberField
              label="Y"
              value={crop.y}
              min={0}
              max={meta.height - 16}
              suffix="px"
              onChange={(v) => setCrop({ ...crop, y: v })}
            />
            <NumberField
              label="Width"
              value={crop.width}
              min={16}
              max={meta.width}
              suffix="px"
              onChange={(v) => setCrop({ ...crop, width: v })}
            />
            <NumberField
              label="Height"
              value={crop.height}
              min={16}
              max={meta.height}
              suffix="px"
              onChange={(v) => setCrop({ ...crop, height: v })}
            />
          </div>
          {invalid && (
            <Alert tone="warn" className="mt-3">
              The crop region must be at least 16×16 px.
            </Alert>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-[13px] font-semibold text-zinc-800">
            Processing settings
          </h3>

          {/* --- one-click presets --------------------------------------- */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-400">
              <Sparkles className="size-3" />
              Presets
            </div>
            <div className="grid grid-cols-2 gap-2">
              {IMAGE_PRESETS.map((p) => {
                const active = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    aria-pressed={active}
                    className={cn(
                      "group rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
                      active
                        ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600/10"
                        : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "text-[13px] font-medium",
                          active ? "text-blue-700" : "text-zinc-800",
                        )}
                      >
                        {p.label}
                      </span>
                      {active && (
                        <Check className="size-3.5 shrink-0 text-blue-600" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      {p.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <p
              className={cn(
                "mt-1.5 text-[10.5px] leading-snug transition-opacity",
                activePreset === "custom"
                  ? "text-zinc-500"
                  : "text-transparent",
              )}
              aria-live="polite"
            >
              {activePreset === "custom"
                ? "Custom settings — no preset selected."
                : ""}
            </p>
          </div>

          <div className="mt-3.5 flex flex-col gap-4">
            <Field label="Piece title (printed on the PDF)">
              <input
                className={inputCls}
                value={title}
                maxLength={140}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Start time"
                value={startTime}
                min={0}
                max={Math.max(0, Math.floor(meta.duration - 1))}
                suffix="s"
                onChange={setStartTime}
              />
              <NumberField
                label="Frame skip"
                value={frameSkip}
                min={1}
                max={600}
                onChange={setFrameSkip}
                hint="Analyze 1 in N frames"
              />
            </div>
            <Field
              label={
                <span className="flex items-center justify-between">
                  <span>Similarity threshold</span>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    {similarity.toFixed(3)}
                  </span>
                </span>
              }
              hint="How alike two frames must be to count as the same line. Lower it if lines are missed; raise it if scrolling splits one line into duplicates."
            >
              <input
                type="range"
                className="slider mt-2 w-full"
                min={0.8}
                max={0.995}
                step={0.005}
                value={similarity}
                onChange={(e) => setSimilarity(Number(e.target.value))}
                aria-label="Similarity threshold"
              />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  <span>Contrast bias</span>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    {thresholdBias >= 0 ? "+" : ""}
                    {thresholdBias}
                  </span>
                </span>
              }
              hint="Fine-tunes the black/white cutoff. Positive keeps the page whiter (hides faint marks); negative preserves fainter marks."
            >
              <input
                type="range"
                className="slider mt-2 w-full"
                min={-40}
                max={40}
                step={1}
                value={thresholdBias}
                onChange={(e) => setThresholdBias(Number(e.target.value))}
                aria-label="Contrast bias"
                disabled={!bw}
              />
            </Field>
            <NumberField
              label="Top trim"
              value={topTrim}
              min={0}
              max={40}
              step={1}
              suffix="px"
              onChange={setTopTrim}
              hint="Rows removed from the top of each line — hides the black border that scrolling notation software often leaves behind."
            />
            <Switch
              checked={bw}
              onChange={setBw}
              label="Black & white cleanup"
              description="Binarize every line and merge duplicate frames for crisp, print-ready pages."
            />
          </div>
        </Card>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={invalid}
            onClick={start}
          >
            <Play className="size-4" />
            Start processing
          </Button>
        </div>
      </div>
    </div>
  );
}
