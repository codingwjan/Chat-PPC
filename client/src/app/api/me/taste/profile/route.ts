import { NextResponse } from "next/server";
import { parseTasteProfileQueryRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { getTasteProfileDetailed } from "@/server/chat-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseTasteProfileQueryRequest({
      clientId: searchParams.get("clientId"),
    });
    const result = await getTasteProfileDetailed(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

