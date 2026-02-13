"use client";

import { Transition } from "@headlessui/react";

interface UiToastProps {
  show: boolean;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  tone?: "error" | "info";
}

export function UiToast({
  show,
  title,
  message,
  actionLabel,
  onAction,
  onClose,
  tone = "error",
}: UiToastProps) {
  const actionClasses = tone === "error"
    ? "text-rose-600 hover:text-rose-500 focus-visible:outline-rose-500"
    : "text-indigo-600 hover:text-indigo-500 focus-visible:outline-indigo-500";

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-0 z-[90] flex items-end px-4 py-6 sm:items-start sm:p-6"
    >
      <div className="flex w-full flex-col items-center space-y-4 sm:items-end">
        <Transition
          show={show}
          enter="transform ease-out duration-300"
          enterFrom="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
          enterTo="translate-y-0 opacity-100 sm:translate-x-0"
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5">
            <div className="flex">
              <div className="w-0 flex-1 p-4">
                {title ? <p className="text-sm font-semibold text-slate-900">{title}</p> : null}
                <p className={`text-sm ${title ? "mt-1" : ""} text-slate-600`}>{message}</p>
              </div>
              {actionLabel && onAction ? (
                <div className="flex border-l border-slate-200">
                  <button
                    type="button"
                    onClick={onAction}
                    className={`flex w-full items-center justify-center px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${actionClasses}`}
                  >
                    {actionLabel}
                  </button>
                </div>
              ) : null}
              {onClose ? (
                <div className="flex border-l border-slate-200">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex w-full items-center justify-center px-4 text-sm font-semibold text-slate-500 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                  >
                    Schließen
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </Transition>
      </div>
    </div>
  );
}
