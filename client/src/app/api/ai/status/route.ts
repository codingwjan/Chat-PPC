import { NextResponse } from "next/server";
import { getAiStatus } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const status = await getAiStatus();
    return NextResponse.json(status);
  } catch (error) {
    return handleApiError(error);
  }
}
