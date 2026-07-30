"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { CropRect } from "@/lib/types";

/**
 * Interactive crop selection: drag to create, drag inside to move, eight
 * handles to resize, arrow keys to nudge, double-click to fill the frame.
 * All values are emitted in *natural video pixels* regardless of how large
 * the frame is displayed.
 */

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: { id: Handle; style: CSSProperties; cursor: string }[] = [
  { id: "nw", style: { left: "0%", top: "0%" }, cursor: "nwse-resize" },
  { id: "n", style: { left: "50%", top: "0%" }, cursor: "ns-resize" },
  { id: "ne", style: { left: "100%", top: "0%" }, cursor: "nesw-resize" },
  { id: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { id: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { id: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { id: "sw", style: { left: "0%", top: "100%" }, cursor: "nesw-resize" },
  { id: "w", style: { left: "0%", top: "50%" }, cursor: "ew-resize" },
];

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function clampRect(
  r: CropRect,
  W: number,
  H: number,
  min: number,
): CropRect {
  const width = Math.min(Math.max(min, Math.round(r.width)), W);
  const height = Math.min(Math.max(min, Math.round(r.height)), H);
  return {
    x: clampNum(Math.round(r.x), 0, W - width),
    y: clampNum(Math.round(r.y), 0, H - height),
    width,
    height,
  };
}

type DragState =
  | { kind: "create"; sx: number; sy: number }
  | { kind: "move"; sx: number; sy: number; orig: CropRect }
  | { kind: "resize"; handle: Handle; orig: CropRect };

export function CropSelector({
  src,
  naturalWidth,
  naturalHeight,
  value,
  onChange,
  minSize = 16,
}: {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  value: CropRect;
  onChange: (r: CropRect) => void;
  minSize?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dispW, setDispW] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setDispW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = dispW > 0 ? dispW / naturalWidth : 0;
  const dispH = naturalHeight * scale;

  const posNat = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const b = ref.current!.getBoundingClientRect();
      return { x: (e.clientX - b.left) / scale, y: (e.clientY - b.top) / scale };
    },
    [scale],
  );

  const emit = useCallback(
    (r: CropRect) => onChange(clampRect(r, naturalWidth, naturalHeight, minSize)),
    [onChange, naturalWidth, naturalHeight, minSize],
  );

  const inside = (p: { x: number; y: number }) =>
    p.x >= value.x &&
    p.x <= value.x + value.width &&
    p.y >= value.y &&
    p.y <= value.y + value.height;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || scale === 0) return;
    e.preventDefault();
    const el = ref.current!;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not critical */
    }
    el.focus({ preventScroll: true });
    const p = posNat(e);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (handle) {
      dragRef.current = { kind: "resize", handle, orig: value };
    } else if (inside(p)) {
      dragRef.current = { kind: "move", sx: p.x, sy: p.y, orig: value };
    } else {
      dragRef.current = {
        kind: "create",
        sx: clampNum(p.x, 0, naturalWidth),
        sy: clampNum(p.y, 0, naturalHeight),
      };
      emit({
        x: clampNum(p.x, 0, naturalWidth),
        y: clampNum(p.y, 0, naturalHeight),
        width: 1,
        height: 1,
      });
    }
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || scale === 0) return;
    const p = posNat(e);
    if (d.kind === "create") {
      emit({
        x: Math.min(d.sx, p.x),
        y: Math.min(d.sy, p.y),
        width: Math.abs(p.x - d.sx),
        height: Math.abs(p.y - d.sy),
      });
    } else if (d.kind === "move") {
      emit({ ...d.orig, x: d.orig.x + (p.x - d.sx), y: d.orig.y + (p.y - d.sy) });
    } else {
      const o = d.orig;
      let l = o.x;
      let t = o.y;
      let r = o.x + o.width;
      let b = o.y + o.height;
      const h = d.handle;
      if (h.includes("w")) l = Math.min(p.x, r - minSize);
      if (h.includes("e")) r = Math.max(p.x, l + minSize);
      if (h.includes("n")) t = Math.min(p.y, b - minSize);
      if (h.includes("s")) b = Math.max(p.y, t + minSize);
      emit({ x: l, y: t, width: r - l, height: b - t });
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    emit({ ...value, x: value.x + dx, y: value.y + dy });
  };

  const d = {
    x: value.x * scale,
    y: value.y * scale,
    w: value.width * scale,
    h: value.height * scale,
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="application"
      aria-label="Crop selection. Drag to create a selection, drag inside to move it, use corner handles to resize, arrow keys nudge by one pixel."
      className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950/[0.03] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-blue-600/40"
      style={{
        aspectRatio: `${naturalWidth} / ${naturalHeight}`,
        cursor: dragging ? "default" : "crosshair",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).dataset.handle) {
          emit({ x: 0, y: 0, width: naturalWidth, height: naturalHeight });
        }
      }}
      onKeyDown={onKeyDown}
    >
      {/* Video frame preview (plain img: served by the local API) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Video frame used for crop selection"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {scale > 0 ? (
        <>
          {/* dimmed surround */}
          <div
            className="absolute inset-x-0 top-0 bg-zinc-950/45"
            style={{ height: d.y }}
          />
          <div
            className="absolute inset-x-0 bg-zinc-950/45"
            style={{
              top: d.y + d.h,
              height: Math.max(0, dispH - (d.y + d.h)),
            }}
          />
          <div
            className="absolute bg-zinc-950/45"
            style={{ left: 0, top: d.y, width: d.x, height: d.h }}
          />
          <div
            className="absolute bg-zinc-950/45"
            style={{
              left: d.x + d.w,
              top: d.y,
              width: Math.max(0, dispW - (d.x + d.w)),
              height: d.h,
            }}
          />
          {/* selection */}
          <div
            className="absolute cursor-move border-2 border-blue-500 bg-blue-500/[0.05] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.55)]"
            style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
          >
            <div className="absolute bottom-1 right-1 rounded-md bg-blue-600 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white shadow tabular-nums">
              {value.width} × {value.height}
            </div>
            {HANDLES.map((h) => (
              <button
                key={h.id}
                type="button"
                data-handle={h.id}
                aria-label={`Resize ${h.id}`}
                tabIndex={-1}
                className="absolute size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-blue-600 bg-white shadow transition-transform hover:scale-125"
                style={{ ...h.style, cursor: h.cursor }}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-zinc-400">
          Loading frame…
        </div>
      )}
    </div>
  );
}
