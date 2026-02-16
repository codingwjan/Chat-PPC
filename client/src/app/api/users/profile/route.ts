import { NextResponse } from "next/server";
import { parsePublicUserProfileQueryRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { getPublicUserProfile } from "@/server/chat-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parsePublicUserProfileQueryRequest({
      viewerClientId: searchParams.get("viewerClientId"),
      targetClientId: searchParams.get("targetClientId"),
    });
    const profile = await getPublicUserProfile(payload);
    return NextResponse.json(profile);
  } catch (error) {
    return handleApiError(error);
  }
}
