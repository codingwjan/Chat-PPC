"use client";

import dynamic from "next/dynamic";

const ChatApp = dynamic(() => import("../../components/chat-app").then((module) => module.ChatApp), {
  ssr: false,
  loading: () => (
    <div className="brand-surface min-h-screen p-8">
      <div className="glass-panel mx-auto max-w-xl rounded-2xl p-4 text-sm text-slate-600">
        Sitzung wird geladen…
      </div>
    </div>
  ),
});

export default function ChatPage() {
  return <ChatApp />;
}
