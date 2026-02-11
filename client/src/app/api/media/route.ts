import { NextResponse } from "next/server";
import { getMediaItems } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const page = await getMediaItems({
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor,
    });

    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
