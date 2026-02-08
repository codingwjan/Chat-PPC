import { NextResponse } from "next/server";
import { parsePresencePingRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { pingPresence } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parsePresencePingRequest(await request.json());
    const user = await pingPresence(payload);
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}
