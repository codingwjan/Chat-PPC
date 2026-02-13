import { NextResponse } from "next/server";
import { parseExtendPollRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { extendPoll } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseExtendPollRequest(await request.json());
    const message = await extendPoll(payload);
    return NextResponse.json(message);
  } catch (error) {
    return handleApiError(error);
  }
}
