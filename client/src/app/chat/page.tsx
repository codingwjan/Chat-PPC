"use client";

import dynamic from "next/dynamic";

const ChatApp = dynamic(() => import("../../components/chat-app").then((module) => module.ChatApp), {
  ssr: false,
  loading: () => (
    <div className="brand-surface min-h-screen p-8">
      <div className="glass-panel mx-auto max-w-xl rounded-2xl p-4 animate-pulse">
        <div className="h-4 w-36 rounded bg-slate-200/70" />
        <div className="mt-3 h-10 rounded-xl bg-slate-200/70" />
        <div className="mt-2 h-10 rounded-xl bg-slate-200/70" />
      </div>
    </div>
  ),
});

export default function ChatPage() {
  return <ChatApp />;
}
