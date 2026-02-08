"use client";

import dynamic from "next/dynamic";

const ChatApp = dynamic(() => import("@/components/chat-app").then((module) => module.ChatApp), {
  ssr: false,
  loading: () => (
    <div className="App">
      <div style={{ paddingTop: "20vh" }}>Loading session...</div>
    </div>
  ),
});

export default function ChatPage() {
  return (
    <main className="chatPageRoot">
      <ChatApp />
    </main>
  );
}
