import { NextResponse } from "next/server";
import { parseCreateMessageRequest } from "@/server/contracts";
import { createMessage, getMessages } from "@/server/chat-service";
import { AppError } from "@/server/errors";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get("limit"));
    const before = parseDate(searchParams.get("before"));
    const after = parseDate(searchParams.get("after"));
    if (before && after) {
      throw new AppError("Use either before or after, not both", 400);
    }

    const messages = await getMessages({ limit, before, after });
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
