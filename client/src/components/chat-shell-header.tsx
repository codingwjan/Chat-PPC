"use client";
/* eslint-disable @next/next/no-img-element */

import { Bars3Icon } from "@heroicons/react/24/outline";

interface ChatShellHeaderProps {
  title: string;
  subtitle: string;
  isDeveloperMode: boolean;
  sessionProfilePicture: string;
  sessionUsername: string;
  onOpenProfileEditor: () => void;
  onOpenSidebar: () => void;
  onOpenMedia: () => void;
}

export function ChatShellHeader({
  title,
  subtitle,
  isDeveloperMode,
  sessionProfilePicture,
  sessionUsername,
  onOpenProfileEditor,
  onOpenSidebar,
  onOpenMedia,
}: ChatShellHeaderProps) {
  return (
    <header className="glass-strip sticky top-0 z-30 flex items-center gap-x-4 border-b px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="-m-2.5 p-2.5 text-slate-700 hover:text-slate-900 lg:hidden"
      >
        <span className="sr-only">Sidebar öffnen</span>
        <Bars3Icon aria-hidden="true" className="size-6" />
      </button>

      <button
        type="button"
        onClick={onOpenProfileEditor}
        className="rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
        title="Profilbild ändern"
        aria-label="Profilbild ändern"
      >
        <img
          src={sessionProfilePicture}
          alt={`${sessionUsername} avatar`}
          className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover [aspect-ratio:1/1]"
          loading="lazy"
          decoding="async"
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
          {isDeveloperMode ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">DEV</span>
          ) : null}
        </div>
        <p className="truncate text-xs text-slate-500 sm:text-sm">{subtitle}</p>
      </div>

      <button
        type="button"
        onClick={onOpenMedia}
        className="glass-panel rounded-md px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50/80"
      >
        Medien
      </button>
    </header>
  );
}
