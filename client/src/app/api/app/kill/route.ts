import { NextResponse } from "next/server";
import { getAppKillState } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const state = await getAppKillState();
    return NextResponse.json(state);
  } catch (error) {
    return handleApiError(error);
  }
}
