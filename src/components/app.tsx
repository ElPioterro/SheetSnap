"use client";

import { Check, FileMusic, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { JobDTO } from "@/lib/types";
import { getJob } from "@/lib/api-client";
import { Button, cn } from "./ui";
import { CropStep } from "./crop-step";
import { ProcessingStep } from "./processing-step";
import { ResultsStep } from "./results-step";
import { SourceStep } from "./source-step";

type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string; desc: string }[] = [
  { n: 1, label: "Source", desc: "Add a video" },
  { n: 2, label: "Crop", desc: "Select the staff area" },
  { n: 3, label: "Process", desc: "Extract the lines" },
  { n: 4, label: "Export", desc: "PDF & images" },
];

export default function App() {
  const [step, setStep] = useState<Step>(1);
  const [job, setJob] = useState<JobDTO | null>(null);

  const jobId = job?.id;
  const jobStatus = job?.status;

  // Poll while a job is preparing (YouTube download) or processing.
  useEffect(() => {
    if (!jobId || (jobStatus !== "processing" && jobStatus !== "preparing"))
      return;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const j = await getJob(jobId!);
        if (cancelled) return;
        setJob(j);
        if (j.status === "pending") setStep(2);
        else if (j.status === "done") setStep(4);
        // error / canceled stay on step 3, where the banner and actions live
      } catch {
        /* transient — keep polling */
      }
    }, 800);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId, jobStatus]);

  const openJob = useCallback((j: JobDTO) => {
    setJob(j);
    if (j.status === "pending") setStep(2);
    else if (j.status === "done") setStep(4);
    else if (j.status === "processing" || j.status === "preparing") setStep(3);
    else setStep(j.meta ? 3 : 1); // error / canceled
  }, []);

  const reset = useCallback(() => {
    setJob(null);
    setStep(1);
  }, []);

  const canGo = (n: Step): boolean => {
    if (!job) return n === 1;
    switch (n) {
      case 1:
        return true;
      case 2:
        return !!job.meta;
      case 3:
        return (
          job.status === "processing" ||
          job.status === "preparing" ||
          job.status === "error" ||
          job.status === "canceled"
        );
      case 4:
        return job.status === "done";
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between border-b border-zinc-200/80">
        <div className="flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white">
            <FileMusic className="size-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">
            SheetSnap
          </span>
          <span className="hidden rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500 sm:inline">
            local studio
          </span>
        </div>
        {job && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" />
            New project
          </Button>
        )}
      </header>

      <nav aria-label="Progress" className="mt-7">
        <ol className="flex items-center">
          {STEPS.map((s, i) => {
            const done = step > s.n;
            const current = step === s.n;
            const enabled = canGo(s.n);
            return (
              <li key={s.n} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                <button
                  // boolean | undefined only — never null — so SSR and the
                  // client render an identical initial tree (hydration fix).
                  disabled={enabled ? undefined : true}
                  onClick={() => enabled && setStep(s.n)}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg py-1 pr-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:pr-3",
                    !enabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold transition-colors",
                      done
                        ? "border-blue-600 bg-blue-600 text-white"
                        : current
                          ? "border-blue-600 bg-white text-blue-700"
                          : "border-zinc-300 bg-white text-zinc-400 group-hover:border-zinc-400",
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : s.n}
                  </span>
                  <span className="hidden sm:block">
                    <span
                      className={cn(
                        "block text-[13px] font-medium leading-tight",
                        current ? "text-zinc-900" : "text-zinc-500",
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="block text-[11px] leading-tight text-zinc-400">
                      {s.desc}
                    </span>
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span
                    className={cn(
                      "mx-2 h-px flex-1 sm:mx-3",
                      step > s.n ? "bg-blue-600" : "bg-zinc-200",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="flex-1 py-7">
        {step === 1 && <SourceStep onJob={openJob} />}
        {step === 2 && job?.meta && (
          <CropStep
            job={job}
            onBack={() => setStep(1)}
            onStarted={(j) => {
              setJob(j);
              setStep(3);
            }}
          />
        )}
        {step === 3 && job && (
          <ProcessingStep
            job={job}
            onRetry={() => setStep(job.meta ? 2 : 1)}
            onRestart={reset}
          />
        )}
        {step === 4 && job?.result && (
          <ResultsStep
            job={job}
            onJob={setJob}
            onAdjust={() => setStep(2)}
            onNew={reset}
          />
        )}
      </main>

      <footer className="border-t border-zinc-200/80 py-5 text-center text-[11px] leading-relaxed text-zinc-400">
        SheetSnap · sheet music extraction — processed entirely on this
        machine.
      </footer>
    </div>
  );
}
