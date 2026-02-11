import { NextResponse } from "next/server";
import { parseCreateMessageRequest } from "@/server/contracts";
import { createMessage, getMessages } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const messages = await getMessages();
    return NextResponse.json(messages);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseCreateMessageRequest(await request.json());
    const message = await createMessage(payload);
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
