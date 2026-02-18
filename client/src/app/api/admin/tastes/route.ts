import { NextResponse } from "next/server";
import { parseAdminTasteQueryRequest } from "@/server/contracts";
import { getDeveloperTasteProfiles } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseAdminTasteQueryRequest({
      clientId: searchParams.get("clientId"),
      devAuthToken: searchParams.get("devAuthToken"),
      limit: searchParams.get("limit") || undefined,
    });
    const result = await getDeveloperTasteProfiles(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
