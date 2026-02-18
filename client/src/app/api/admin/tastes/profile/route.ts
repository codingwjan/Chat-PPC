import { NextResponse } from "next/server";
import { parseAdminTasteProfileQueryRequest } from "@/server/contracts";
import { getAdminTasteProfileDetailed } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseAdminTasteProfileQueryRequest({
      clientId: searchParams.get("clientId"),
      devAuthToken: searchParams.get("devAuthToken"),
      targetClientId: searchParams.get("targetClientId"),
    });
    const result = await getAdminTasteProfileDetailed(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
