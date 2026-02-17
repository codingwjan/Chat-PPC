"use client";

import { Transition } from "@headlessui/react";
import { InformationCircleIcon, XCircleIcon } from "@heroicons/react/20/solid";
import { XMarkIcon } from "@heroicons/react/24/outline";

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
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const isError = tone === "error";
  const headingClasses = isError ? "text-red-800" : "text-sky-900";
  const textClasses = isError ? "text-red-700" : "text-sky-800";
  const panelClasses = isError
    ? "rounded-md bg-red-50 p-4"
    : "rounded-md bg-sky-50 p-4";
  const iconClasses = isError ? "size-5 text-red-400" : "size-5 text-sky-500";
  const actionClasses = isError
    ? "text-red-700 hover:text-red-600 focus-visible:outline-red-500"
    : "text-sky-700 hover:text-sky-600 focus-visible:outline-sky-500";

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
          <div className={`pointer-events-auto w-full max-w-md shadow-lg ring-1 ring-black/5 ${panelClasses}`}>
            <div className="flex">
              <div className="shrink-0">
                {isError ? (
                  <XCircleIcon aria-hidden="true" className={iconClasses} />
                ) : (
                  <InformationCircleIcon aria-hidden="true" className={iconClasses} />
                )}
              </div>
              <div className="ml-3 min-w-0 flex-1">
                {title ? <h3 className={`text-sm font-medium ${headingClasses}`}>{title}</h3> : null}
                <div className={`text-sm ${title ? "mt-2" : ""} ${textClasses}`}>
                  {lines.length > 1 ? (
                    <ul role="list" className="list-disc space-y-1 pl-5">
                      {lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{lines[0] || message}</p>
                  )}
                </div>
                {actionLabel && onAction ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={onAction}
                      className={`text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${actionClasses}`}
                    >
                      {actionLabel}
                    </button>
                  </div>
                ) : null}
              </div>
              {onClose ? (
                <div className="ml-3 flex shrink-0">
                  <button
                    type="button"
                    onClick={onClose}
                    className={`rounded-md p-1.5 ${actionClasses} focus-visible:outline-2 focus-visible:outline-offset-2`}
                  >
                    <span className="sr-only">Schließen</span>
                    <XMarkIcon className="size-4" aria-hidden="true" />
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
