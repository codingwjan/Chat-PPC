import { NextResponse } from "next/server";
import { parseBotManagerQueryRequest, parseCreateBotRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { createBot, getManagedBots } from "@/server/chat-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseBotManagerQueryRequest({
      clientId: searchParams.get("clientId"),
    });
    const result = await getManagedBots(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseCreateBotRequest(await request.json());
    const result = await createBot(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
