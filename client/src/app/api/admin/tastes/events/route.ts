import { NextResponse } from "next/server";
import { parseAdminTasteEventsQueryRequest } from "@/server/contracts";
import { getAdminTasteProfileEvents } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseAdminTasteEventsQueryRequest({
      clientId: searchParams.get("clientId"),
      devAuthToken: searchParams.get("devAuthToken"),
      targetClientId: searchParams.get("targetClientId"),
      limit: searchParams.get("limit") || undefined,
      before: searchParams.get("before") || undefined,
    });
    const result = await getAdminTasteProfileEvents(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
