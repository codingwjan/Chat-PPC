import type { SseEnvelope, SseEventName, SseEventPayloadMap } from "@/lib/types";

type EventListener = (event: SseEnvelope) => void;

const listeners = new Set<EventListener>();
let sequence = 0;

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publish<TEvent extends SseEventName>(
  event: TEvent,
  data: SseEventPayloadMap[TEvent],
): void {
  const payload: SseEnvelope<TEvent> = {
    id: `${Date.now()}-${++sequence}`,
    event,
    data,
  };

  listeners.forEach((listener) => listener(payload));
}

export function formatSseEvent(envelope: SseEnvelope): string {
  return `id: ${envelope.id}\nevent: ${envelope.event}\ndata: ${JSON.stringify(envelope.data)}\n\n`;
}
