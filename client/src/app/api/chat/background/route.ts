import { NextResponse } from "next/server";
import { parseUpdateChatBackgroundRequest } from "@/server/contracts";
import { getChatBackground, setChatBackground } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const background = await getChatBackground();
    return NextResponse.json(background);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseUpdateChatBackgroundRequest(await request.json());
    const background = await setChatBackground(payload);
    return NextResponse.json(background);
  } catch (error) {
    return handleApiError(error);
  }
}
