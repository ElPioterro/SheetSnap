"use client";

import {
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  X,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
} from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- button ----------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonStyles(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  const base =
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:pointer-events-none disabled:opacity-45";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
    secondary:
      "border border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900",
    ghost: "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
    danger:
      "border border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "h-8 px-3 text-[13px]",
    md: "h-9 px-3.5 text-sm",
    lg: "h-10 px-4 text-sm",
  };
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={buttonStyles(variant, size, className)}
      // Normalize every caller-provided value to boolean | undefined so
      // server and client renders always agree (React treats null as an
      // explicit value but undefined as absent, which can mismatch).
      disabled={disabled || loading ? true : undefined}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

// --- layout primitives ------------------------------------------------------

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.03)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type ChipTone = "zinc" | "blue" | "green" | "red" | "amber";

export function Chip({
  tone = "zinc",
  className,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<ChipTone, string> = {
    zinc: "bg-zinc-100 text-zinc-600",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-zinc-200", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// --- form controls -----------------------------------------------------------

export const inputCls =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-[0_1px_2px_rgb(0_0_0/0.03)] placeholder:text-zinc-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 disabled:opacity-50";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      {label && (
        <span className="mb-1.5 block text-[12px] font-medium text-zinc-600">
          {label}
        </span>
      )}
      {children}
      {hint && (
        <span className="mt-1.5 block text-[11px] leading-relaxed text-zinc-400">
          {hint}
        </span>
      )}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  hint,
  className,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
  className?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <input
          type="number"
          inputMode="numeric"
          className={cn(
            inputCls,
            "no-spin font-mono text-[13px] tabular-nums",
            suffix && "pr-10",
          )}
          value={Number.isFinite(value) ? value : ""}
          step={step}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          onBlur={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150",
          checked ? "border-blue-600 bg-blue-600" : "border-zinc-300 bg-zinc-200",
        )}
      >
        <span
          className={cn(
            "mx-[2px] block size-[14px] rounded-full bg-white shadow transition-transform duration-150",
            checked && "translate-x-4",
          )}
        />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-zinc-800">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5"
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-colors",
            value === o.value
              ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- feedback -----------------------------------------------------------------

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "error" | "warn";
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    error: "border-red-200 bg-red-50 text-red-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
  } as const;
  const Icon = tone === "error" ? AlertCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "anim-fade flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed",
        tones[tone],
        className,
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "anim-pop relative max-w-full rounded-xl border border-zinc-200 bg-white shadow-2xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md bg-white/80 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
