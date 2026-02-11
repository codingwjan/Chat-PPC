import { NextResponse } from "next/server";
import { getOnlineUsers } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const users = await getOnlineUsers();
    return NextResponse.json(users);
  } catch (error) {
    return handleApiError(error);
  }
}
