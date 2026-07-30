"use client";

import {
  ChevronRight,
  FileMusic,
  FileVideo,
  Link2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobDTO, JobStatus } from "@/lib/types";
import {
  ApiClientError,
  fetchYouTube,
  listJobs,
  uploadVideo,
} from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  Card,
  Chip,
  type ChipTone,
  Field,
  Progress,
  Segmented,
  Spinner,
  cn,
  inputCls,
} from "./ui";

const STATUS_TONE: Record<JobStatus, ChipTone> = {
  preparing: "blue",
  pending: "amber",
  processing: "blue",
  done: "green",
  error: "red",
  canceled: "zinc",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  preparing: "fetching",
  pending: "crop",
  processing: "processing",
  done: "done",
  error: "error",
  canceled: "canceled",
};

export function SourceStep({ onJob }: { onJob: (job: JobDTO) => void }) {
  const [tab, setTab] = useState<"upload" | "youtube">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [url, setUrl] = useState("");
  const [ytBusy, setYtBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<JobDTO[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listJobs()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const startFile = useCallback(
    (file: File) => {
      setError(null);
      setUpload({ name: file.name, pct: 0 });
      uploadVideo(file, (pct) => setUpload({ name: file.name, pct }))
        .then((job) => {
          setUpload(null);
          if (job.status === "error") {
            setError(job.error ?? "Could not read this video file.");
            return;
          }
          onJob(job);
        })
        .catch((e) => {
          setUpload(null);
          setError(
            e instanceof ApiClientError ? e.message : "The upload failed.",
          );
        });
    },
    [onJob],
  );

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || ytBusy) return;
    setError(null);
    setYtBusy(true);
    fetchYouTube(url.trim())
      .then(onJob)
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not start the download.",
        ),
      )
      .finally(() => setYtBusy(false));
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
      <Card className="p-6">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Add your video
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Upload a piano or music tutorial video, or paste a YouTube link.
          Everything is processed locally on this machine.
        </p>
        <div className="mt-5">
          <Segmented
            options={[
              {
                value: "upload",
                label: "Upload file",
                icon: <UploadCloud className="size-4" />,
              },
              {
                value: "youtube",
                label: "YouTube URL",
                icon: <Link2 className="size-4" />,
              },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        {tab === "upload" ? (
          <div className="mt-5">
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a video file or browse"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) startFile(f);
              }}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-visible:outline-2 focus-visible:outline-blue-600",
                dragOver
                  ? "border-blue-500 bg-blue-50/60"
                  : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
              )}
            >
              <div
                className={cn(
                  "grid size-12 place-items-center rounded-full transition-colors",
                  dragOver
                    ? "bg-blue-100 text-blue-600"
                    : "bg-zinc-100 text-zinc-400 group-hover:bg-blue-50 group-hover:text-blue-600",
                )}
              >
                <FileVideo className="size-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-800">
                  {dragOver ? "Drop to upload" : "Drop your video here"}
                </p>
                <p className="mt-1 text-[13px] text-zinc-500">
                  or <span className="font-medium text-blue-600">browse your files</span>
                </p>
              </div>
              <p className="text-[11px] tracking-wide text-zinc-400">
                MP4 · MOV · MKV · WEBM · AVI — up to 2 GB
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,.mov,.mkv,.webm,.avi,.m4v,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) startFile(f);
                e.target.value = "";
              }}
            />
            {upload && (
              <div className="anim-fade mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="flex min-w-0 items-center gap-1.5 text-zinc-600">
                    <Spinner className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {upload.pct >= 1
                        ? "Preparing the preview frame…"
                        : `Uploading ${upload.name}`}
                    </span>
                  </span>
                  <span className="font-mono text-zinc-500 tabular-nums">
                    {Math.round(upload.pct * 100)}%
                  </span>
                </div>
                <Progress value={upload.pct} />
              </div>
            )}
          </div>
        ) : (
          <form className="mt-5" onSubmit={submitUrl}>
            <Field
              label="YouTube URL"
              hint="Fetched with yt-dlp and processed entirely on this machine. yt-dlp ships with the desktop app; for local development install it or set YTDLP_PATH. Local file upload works either way."
            >
              <input
                className={cn(inputCls, "font-mono text-[13px]")}
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="mt-4"
              loading={ytBusy}
              disabled={!url.trim()}
            >
              <Link2 className="size-4" />
              Fetch video
            </Button>
          </form>
        )}
      </Card>

      <Card className="flex min-h-[280px] flex-col p-5">
        <h3 className="text-[13px] font-semibold text-zinc-800">
          Recent projects
        </h3>
        {recent === null ? (
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-zinc-100"
              />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 py-10 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-zinc-100 text-zinc-400">
              <FileMusic className="size-5" />
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Nothing here yet.
              <br />
              Your extracted pieces will show up here.
            </p>
          </div>
        ) : (
          <ul className="-mx-2 mt-2 divide-y divide-zinc-100">
            {recent.slice(0, 6).map((j) => (
              <li key={j.id}>
                <button
                  onClick={() => onJob(j)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
                    <FileMusic className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-800">
                      {j.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-zinc-400">
                      {j.sourceType === "youtube" ? "YouTube" : "Upload"} ·{" "}
                      {fmtDate(j.createdAt)}
                      {j.result ? ` · ${j.result.lineCount} lines` : ""}
                    </span>
                  </span>
                  <Chip tone={STATUS_TONE[j.status]}>
                    {STATUS_LABEL[j.status]}
                  </Chip>
                  <ChevronRight className="size-3.5 shrink-0 text-zinc-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
