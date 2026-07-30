import type { JobDTO, ProcessParams } from "./types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function handle<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? `Request failed (HTTP ${res.status}).`,
    );
  }
  return data as T;
}

export async function listJobs(): Promise<JobDTO[]> {
  return (
    await handle<{ jobs: JobDTO[] }>(
      await fetch("/api/jobs", { cache: "no-store" }),
    )
  ).jobs;
}

export async function getJob(id: string): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(await fetch(`/api/jobs/${id}`, { cache: "no-store" }))
  ).job;
}

export async function fetchYouTube(url: string): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(
      await fetch("/api/source/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    )
  ).job;
}

export async function startProcessing(
  id: string,
  params: ProcessParams,
): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(
      await fetch(`/api/jobs/${id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
    )
  ).job;
}

export async function cancelJob(id: string): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(
      await fetch(`/api/jobs/${id}/cancel`, { method: "POST" }),
    )
  ).job;
}

export async function deleteLine(id: string, name: string): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(
      await fetch(
        `/api/jobs/${id}/lines?name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
    )
  ).job;
}

/** Refresh result.pdf / result.zip after lines have been deleted. */
export async function rebuildJobArtifacts(id: string): Promise<JobDTO> {
  return (
    await handle<{ job: JobDTO }>(
      await fetch(`/api/jobs/${id}/rebuild`, { method: "POST" }),
    )
  ).job;
}

export function jobFileUrl(id: string, name: string, download = false): string {
  return `/api/jobs/${id}/file?name=${encodeURIComponent(name)}${download ? "&download=1" : ""}`;
}

/** XHR-based upload so we get real upload progress events. */
export function uploadVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<JobDTO> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/source/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: ({ job?: JobDTO } & ErrorBody) | null = null;
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* handled below */
      }
      if (xhr.status >= 400 || !data?.job) {
        reject(
          new ApiClientError(
            xhr.status,
            data?.error?.code ?? "UPLOAD_FAILED",
            data?.error?.message ?? `Upload failed (HTTP ${xhr.status}).`,
          ),
        );
      } else {
        resolve(data.job);
      }
    };
    xhr.onerror = () =>
      reject(new ApiClientError(0, "NETWORK", "Network error during the upload."));
    xhr.onabort = () =>
      reject(new ApiClientError(0, "ABORTED", "The upload was aborted."));
    xhr.send(file);
  });
}
