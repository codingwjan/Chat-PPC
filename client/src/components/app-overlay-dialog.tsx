"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useCallback, useTransition } from "react";

interface AppOverlayDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  zIndexClassName?: string;
}

export function AppOverlayDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidthClassName = "sm:max-w-2xl",
  panelClassName = "",
  bodyClassName = "",
  zIndexClassName = "z-[68]",
}: AppOverlayDialogProps) {
  const [, startCloseTransition] = useTransition();

  const handleClose = useCallback(() => {
    startCloseTransition(() => {
      onClose();
    });
  }, [onClose, startCloseTransition]);

  const panelClasses = [
    "glass-panel-strong relative flex max-h-[92dvh] w-full transform flex-col overflow-hidden rounded-2xl text-left transition-all",
    "data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in",
    "data-closed:sm:translate-y-0 data-closed:sm:scale-95",
    maxWidthClassName,
    panelClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const bodyClasses = ["min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6", bodyClassName].filter(Boolean).join(" ");

  return (
    <Dialog open={open} onClose={handleClose} className={`relative ${zIndexClassName}`}>
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />

      <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-2 text-center sm:items-center sm:p-4">
          <DialogPanel transition className={panelClasses}>
            <div className="absolute top-0 right-0 pt-3 pr-3 sm:pt-4 sm:pr-4">
              <button
                type="button"
                onClick={handleClose}
                className="glass-panel rounded-md text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <span className="sr-only">Schließen</span>
                <XMarkIcon aria-hidden="true" className="size-6" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-4 py-4 pr-14 sm:px-6">
              <DialogTitle as="h3" className="text-lg font-semibold text-slate-900">
                {title}
              </DialogTitle>
              {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
            </div>

            <div className={bodyClasses}>{children}</div>

            {footer ? <div className="border-t border-slate-200 px-4 py-3 sm:px-6">{footer}</div> : null}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
