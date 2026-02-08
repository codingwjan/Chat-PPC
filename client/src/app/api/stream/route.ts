import { formatSseEvent, subscribe } from "@/lib/sse-bus";
import { getSnapshot } from "@/server/chat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request): Promise<Response> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: string) => {
        controller.enqueue(encoder.encode(payload));
      };

      const snapshot = await getSnapshot();
      push(formatSseEvent({ id: `${Date.now()}-snapshot`, event: "snapshot", data: snapshot }));

      const unsubscribe = subscribe((event) => {
        push(formatSseEvent(event));
      });

      const interval = setInterval(() => {
        push(":keepalive\n\n");
      }, 20_000);

      const onAbort = () => {
        clearInterval(interval);
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
