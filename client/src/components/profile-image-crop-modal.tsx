"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";

interface ProfileImageCropModalProps {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void> | void;
}

const PREVIEW_SIZE = 300;
const OUTPUT_SIZE = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPreviewMetrics(imageElement: HTMLImageElement | null, zoom: number): {
  width: number;
  height: number;
  maxShiftX: number;
  maxShiftY: number;
} {
  if (!imageElement) {
    return {
      width: PREVIEW_SIZE,
      height: PREVIEW_SIZE,
      maxShiftX: 0,
      maxShiftY: 0,
    };
  }

  const baseScale = Math.max(PREVIEW_SIZE / imageElement.naturalWidth, PREVIEW_SIZE / imageElement.naturalHeight);
  const width = imageElement.naturalWidth * baseScale * zoom;
  const height = imageElement.naturalHeight * baseScale * zoom;

  return {
    width,
    height,
    maxShiftX: Math.max(0, (width - PREVIEW_SIZE) / 2),
    maxShiftY: Math.max(0, (height - PREVIEW_SIZE) / 2),
  };
}

export function ProfileImageCropModal({
  file,
  busy = false,
  onCancel,
  onConfirm,
}: ProfileImageCropModalProps) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [imageLoading, setImageLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const zoomRef = useRef(1);
  const interactionRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    dragPointerId: number | null;
    dragStartX: number;
    dragStartY: number;
    dragStartPanX: number;
    dragStartPanY: number;
    pinchStartDistance: number | null;
    pinchStartZoom: number;
  }>({
    pointers: new Map(),
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartPanX: 0,
    dragStartPanY: 0,
    pinchStartDistance: null,
    pinchStartZoom: 1,
  });

  useEffect(() => {
    panXRef.current = panX;
  }, [panX]);

  useEffect(() => {
    panYRef.current = panY;
  }, [panY]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    const reader = new FileReader();

    reader.onload = () => {
      if (cancelled) return;
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setError("Could not read selected image.");
        setImageLoading(false);
        return;
      }
      setImageSrc(result);
    };

    reader.onerror = () => {
      if (cancelled) return;
      setError("Could not load selected image.");
      setImageLoading(false);
    };

    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
      }
    };
  }, [file]);

  const previewFrame = useMemo(() => {
    const metrics = getPreviewMetrics(imageElement, zoom);

    return {
      width: metrics.width,
      height: metrics.height,
      left: (PREVIEW_SIZE - metrics.width) / 2 + panX * metrics.maxShiftX,
      top: (PREVIEW_SIZE - metrics.height) / 2 + panY * metrics.maxShiftY,
    };
  }, [imageElement, panX, panY, zoom]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageElement) return;
    event.preventDefault();
    setError(null);

    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const interaction = interactionRef.current;
    interaction.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (interaction.pointers.size === 1) {
      interaction.dragPointerId = event.pointerId;
      interaction.dragStartX = event.clientX;
      interaction.dragStartY = event.clientY;
      interaction.dragStartPanX = panXRef.current;
      interaction.dragStartPanY = panYRef.current;
      interaction.pinchStartDistance = null;
      return;
    }

    if (interaction.pointers.size >= 2) {
      const [first, second] = [...interaction.pointers.values()];
      interaction.pinchStartDistance = Math.hypot(second.x - first.x, second.y - first.y);
      interaction.pinchStartZoom = zoomRef.current;
      interaction.dragPointerId = null;
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction.pointers.has(event.pointerId)) return;

    interaction.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (interaction.pointers.size >= 2 && interaction.pinchStartDistance && imageElement) {
      const [first, second] = [...interaction.pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const ratio = interaction.pinchStartDistance > 0 ? distance / interaction.pinchStartDistance : 1;
      setZoom(clamp(interaction.pinchStartZoom * ratio, 1, 3));
      return;
    }

    if (interaction.dragPointerId !== event.pointerId || !imageElement) return;

    const metrics = getPreviewMetrics(imageElement, zoomRef.current);
    const deltaX = event.clientX - interaction.dragStartX;
    const deltaY = event.clientY - interaction.dragStartY;
    const panDeltaX = metrics.maxShiftX > 0 ? deltaX / metrics.maxShiftX : 0;
    const panDeltaY = metrics.maxShiftY > 0 ? deltaY / metrics.maxShiftY : 0;

    setPanX(clamp(interaction.dragStartPanX + panDeltaX, -1, 1));
    setPanY(clamp(interaction.dragStartPanY + panDeltaY, -1, 1));
  }

  function handlePointerUpOrCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    interaction.pointers.delete(event.pointerId);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (interaction.dragPointerId === event.pointerId) {
      interaction.dragPointerId = null;
    }

    if (interaction.pointers.size < 2) {
      interaction.pinchStartDistance = null;
    }

    if (interaction.pointers.size === 1) {
      const [pointerId, pointer] = [...interaction.pointers.entries()][0];
      interaction.dragPointerId = pointerId;
      interaction.dragStartX = pointer.x;
      interaction.dragStartY = pointer.y;
      interaction.dragStartPanX = panXRef.current;
      interaction.dragStartPanY = panYRef.current;
    }
  }

  async function confirmCrop() {
    if (!imageElement) {
      setError("Image not ready yet.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      setError("Cropper is not ready.");
      return;
    }

    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;
    const side = Math.min(width, height) / zoom;
    const maxOffsetX = (width - side) / 2;
    const maxOffsetY = (height - side) / 2;
    // Keep export aligned with live preview movement.
    const sourceX = clamp((width - side) / 2 - panX * maxOffsetX, 0, width - side);
    const sourceY = clamp((height - side) / 2 - panY * maxOffsetY, 0, height - side);

    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    const context = canvas.getContext("2d");
    if (!context) {
      setError("Canvas context is unavailable.");
      return;
    }

    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    context.drawImage(
      imageElement,
      sourceX,
      sourceY,
      side,
      side,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png", 0.95);
    });

    if (!blob) {
      setError("Could not create cropped image.");
      return;
    }

    const baseName = file.name.replace(/\.[^/.]+$/, "") || "avatar";
    const croppedFile = new File([blob], `${baseName}-cropped.png`, { type: "image/png" });

    try {
      await onConfirm(croppedFile);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Could not upload cropped image.");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/55 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-3xl border border-white/70 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-bold text-slate-900">Crop Profile Picture</h3>
          <p className="text-sm text-slate-500">Drag to move. Use two fingers to zoom. Then upload.</p>
        </div>

        <div className="mx-auto w-[300px]">
          <div
            className="relative h-[300px] w-[300px] cursor-grab overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 shadow-inner active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUpOrCancel}
            onPointerCancel={handlePointerUpOrCancel}
          >
            {imageLoading ? (
              <div className="absolute inset-0 animate-pulse bg-slate-200" />
            ) : null}
            {imageSrc ? (
              <img
                src={imageSrc}
                alt="Crop preview"
                className="absolute max-w-none select-none"
                draggable={false}
                style={{
                  width: `${previewFrame.width}px`,
                  height: `${previewFrame.height}px`,
                  left: `${previewFrame.left}px`,
                  top: `${previewFrame.top}px`,
                }}
                onLoad={(event) => {
                  setImageElement(event.currentTarget);
                  setImageLoading(false);
                }}
                onError={() => {
                  setError("Selected image format could not be rendered in the cropper.");
                  setImageLoading(false);
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-xs font-medium text-slate-600">
            Horizontal
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={panX}
              onChange={(event) => setPanX(Number(event.target.value))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-xs font-medium text-slate-600">
            Vertical
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={panY}
              onChange={(event) => setPanY(Number(event.target.value))}
              className="mt-1 w-full"
            />
          </label>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600" aria-live="polite">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmCrop()}
            className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Uploading…" : "Crop & Upload"}
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
