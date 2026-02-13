"use client";
/* eslint-disable @next/next/no-img-element */

import { Dialog, DialogBackdrop, DialogPanel, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ReactNode } from "react";

interface ChatShellSidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  username: string;
  profilePicture: string;
  statusLabel: string;
  onOpenProfileEditor: () => void;
  onlineUsersContent: ReactNode;
  notificationContent?: ReactNode;
  backgroundContent?: ReactNode;
  developerContent?: ReactNode;
  onLogout: () => void;
}

function SidebarBody({
  username,
  profilePicture,
  statusLabel,
  onOpenProfileEditor,
  onlineUsersContent,
  notificationContent,
  backgroundContent,
  developerContent,
  onLogout,
}: Omit<ChatShellSidebarProps, "mobileOpen" | "onCloseMobile">) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-y-3 border-r border-slate-200 bg-white/90 px-4 py-4 backdrop-blur">
      <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <button
          type="button"
          onClick={onOpenProfileEditor}
          className="rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          title="Profilbild ändern"
          aria-label="Profilbild ändern"
        >
          <img
            src={profilePicture}
            alt={`${username} avatar`}
            className="h-12 w-12 shrink-0 rounded-full border border-slate-200 object-cover [aspect-ratio:1/1]"
            loading="lazy"
            decoding="async"
          />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{username}</p>
          <p className="truncate text-xs text-slate-500">{statusLabel}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenProfileEditor}
        className="h-10 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700"
      >
        Profil bearbeiten
      </button>

      {backgroundContent}
      {notificationContent}
      {developerContent}

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">ChatPPC Online</p>
        <div className="space-y-2">{onlineUsersContent}</div>
      </div>

      <button
        onClick={onLogout}
        className="mt-2 h-10 rounded-xl bg-rose-600 text-sm font-semibold text-white"
      >
        Chat verlassen
      </button>
    </div>
  );
}

export function ChatShellSidebar({
  mobileOpen,
  onCloseMobile,
  username,
  profilePicture,
  statusLabel,
  onOpenProfileEditor,
  onlineUsersContent,
  notificationContent,
  backgroundContent,
  developerContent,
  onLogout,
}: ChatShellSidebarProps) {
  return (
    <>
      <Dialog open={mobileOpen} onClose={onCloseMobile} className="relative z-50 lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-slate-900/70 transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />

        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <TransitionChild>
              <div className="absolute top-0 left-full flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
                <button type="button" onClick={onCloseMobile} className="-m-2.5 p-2.5">
                  <span className="sr-only">Sidebar schließen</span>
                  <XMarkIcon aria-hidden="true" className="size-6 text-white" />
                </button>
              </div>
            </TransitionChild>

            <div className="w-full">
              <SidebarBody
                username={username}
                profilePicture={profilePicture}
                statusLabel={statusLabel}
                onOpenProfileEditor={onOpenProfileEditor}
                onlineUsersContent={onlineUsersContent}
                notificationContent={notificationContent}
                backgroundContent={backgroundContent}
                developerContent={developerContent}
                onLogout={onLogout}
              />
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-72 lg:flex-col">
        <SidebarBody
          username={username}
          profilePicture={profilePicture}
          statusLabel={statusLabel}
          onOpenProfileEditor={onOpenProfileEditor}
          onlineUsersContent={onlineUsersContent}
          notificationContent={notificationContent}
          backgroundContent={backgroundContent}
          developerContent={developerContent}
          onLogout={onLogout}
        />
      </aside>
    </>
  );
}
