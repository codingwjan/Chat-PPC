import { NextResponse } from "next/server";
import { parseTypingRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { setTypingStatus } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseTypingRequest(await request.json());
    const user = await setTypingStatus(payload);
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}
