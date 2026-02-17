import { NextResponse } from "next/server";
import { handleApiError } from "@/server/http";
import { getTasteProfile } from "@/server/chat-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId")?.trim();
    if (!clientId) {
      return NextResponse.json({ error: "clientId ist erforderlich" }, { status: 400 });
    }

    const result = await getTasteProfile({ clientId });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
