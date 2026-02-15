import { NextResponse } from "next/server";
import { parseReactMessageRequest } from "@/server/contracts";
import { AppError } from "@/server/errors";
import { handleApiError } from "@/server/http";
import { reactToMessage } from "@/server/chat-service";

export const runtime = "nodejs";

const REACTION_RATE_LIMIT_MAX_PER_MINUTE = 40;
const REACTION_RATE_LIMIT_WINDOW_MS = 60_000;

const reactionRateState = new Map<string, { windowStart: number; count: number }>();

function assertReactionRateLimit(clientId: string): void {
  const now = Date.now();
  const current = reactionRateState.get(clientId);

  if (!current || now - current.windowStart >= REACTION_RATE_LIMIT_WINDOW_MS) {
    reactionRateState.set(clientId, { windowStart: now, count: 1 });
    return;
  }

  if (current.count >= REACTION_RATE_LIMIT_MAX_PER_MINUTE) {
    throw new AppError("Zu viele Reaktionen in kurzer Zeit. Bitte kurz warten.", 429);
  }

  current.count += 1;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseReactMessageRequest(await request.json());
    assertReactionRateLimit(payload.clientId);
    const message = await reactToMessage(payload);
    return NextResponse.json(message);
  } catch (error) {
    return handleApiError(error);
  }
}
