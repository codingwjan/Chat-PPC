import { NextResponse } from "next/server";
import { parseDeleteBotRequest, parseUpdateBotRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { deleteBot, updateBot } from "@/server/chat-service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ botId: string }> },
): Promise<NextResponse> {
  try {
    const { botId } = await context.params;
    const payload = parseUpdateBotRequest(await request.json());
    const result = await updateBot({ botId, ...payload });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ botId: string }> },
): Promise<NextResponse> {
  try {
    const { botId } = await context.params;
    const payload = parseDeleteBotRequest(await request.json());
    const result = await deleteBot({ botId, ...payload });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
