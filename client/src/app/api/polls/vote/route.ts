import { NextResponse } from "next/server";
import { parseVotePollRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { votePoll } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseVotePollRequest(await request.json());
    const message = await votePoll(payload);
    return NextResponse.json(message);
  } catch (error) {
    return handleApiError(error);
  }
}
