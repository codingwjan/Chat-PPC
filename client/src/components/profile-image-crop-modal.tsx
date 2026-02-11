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

export function ProfileImageCropModal({
  file,
  busy = false,
  onCancel,
  onConfirm,
}: ProfileImageCropModalProps) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const previewFrame = useMemo(() => {
    if (!imageElement) {
      return {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        left: 0,
        top: 0,
      };
    }

    const baseScale = Math.max(PREVIEW_SIZE / imageElement.naturalWidth, PREVIEW_SIZE / imageElement.naturalHeight);
    const width = imageElement.naturalWidth * baseScale * zoom;
    const height = imageElement.naturalHeight * baseScale * zoom;
    const maxShiftX = Math.max(0, (width - PREVIEW_SIZE) / 2);
    const maxShiftY = Math.max(0, (height - PREVIEW_SIZE) / 2);

    return {
      width,
      height,
      left: (PREVIEW_SIZE - width) / 2 + panX * maxShiftX,
      top: (PREVIEW_SIZE - height) / 2 + panY * maxShiftY,
    };
  }, [imageElement, panX, panY, zoom]);

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
    const sourceX = clamp((width - side) / 2 + panX * maxOffsetX, 0, width - side);
    const sourceY = clamp((height - side) / 2 + panY * maxOffsetY, 0, height - side);

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
    await onConfirm(croppedFile);
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/55 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-3xl border border-white/70 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-bold text-slate-900">Crop Profile Picture</h3>
          <p className="text-sm text-slate-500">Adjust zoom and position, then upload.</p>
        </div>

        <div className="mx-auto w-[300px]">
          <div className="relative h-[300px] w-[300px] overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 shadow-inner">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Crop preview"
                className="absolute max-w-none select-none"
                draggable={false}
                style={{
                  width: `${previewFrame.width}px`,
                  height: `${previewFrame.height}px`,
                  left: `${previewFrame.left}px`,
                  top: `${previewFrame.top}px`,
                }}
                onLoad={(event) => setImageElement(event.currentTarget)}
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
