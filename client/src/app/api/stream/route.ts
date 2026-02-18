import { formatSseEvent, subscribe } from "@/lib/sse-bus";
import { getSnapshot } from "@/server/chat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const DEFAULT_SNAPSHOT_LIMIT = 40;
const MAX_SNAPSHOT_LIMIT = 120;

function parseSnapshotLimit(request: Request): number {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("limit");
  if (!raw) return DEFAULT_SNAPSHOT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SNAPSHOT_LIMIT;
  return Math.max(1, Math.min(MAX_SNAPSHOT_LIMIT, parsed));
}

function parseViewerClientId(request: Request): string | undefined {
  const { searchParams } = new URL(request.url);
  const value = searchParams.get("clientId")?.trim();
  return value || undefined;
}

export async function GET(request: Request): Promise<Response> {
  const snapshotLimit = parseSnapshotLimit(request);
  const viewerClientId = parseViewerClientId(request);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: string) => {
        controller.enqueue(encoder.encode(payload));
      };

      push("retry: 1000\n\n");

      const snapshot = await getSnapshot({ limit: snapshotLimit, viewerClientId });
      push(formatSseEvent({ id: `${Date.now()}-snapshot`, event: "snapshot", data: snapshot }));

      const unsubscribe = subscribe((event) => {
        push(formatSseEvent(event));
      });

      const interval = setInterval(() => {
        push(`event: ping\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
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
      "X-Accel-Buffering": "no",
    },
  });
}
