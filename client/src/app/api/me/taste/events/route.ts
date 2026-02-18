import { NextResponse } from "next/server";
import { parseTasteEventsQueryRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { getTasteProfileEvents } from "@/server/chat-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseTasteEventsQueryRequest({
      clientId: searchParams.get("clientId"),
      limit: searchParams.get("limit") ?? undefined,
      before: searchParams.get("before") ?? undefined,
    });
    const result = await getTasteProfileEvents(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

