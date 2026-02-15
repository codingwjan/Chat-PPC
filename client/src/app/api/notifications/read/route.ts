import { NextResponse } from "next/server";
import { parseMarkNotificationsReadRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { markNotificationsRead } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseMarkNotificationsReadRequest(await request.json());
    const result = await markNotificationsRead(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
