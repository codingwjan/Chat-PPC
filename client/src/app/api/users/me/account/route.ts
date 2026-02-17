import { NextResponse } from "next/server";
import { parseUpdateOwnAccountRequest } from "@/server/contracts";
import { setAuthSessionCookie } from "@/server/auth-cookie";
import { handleApiError } from "@/server/http";
import { updateOwnAccount } from "@/server/chat-service";

export const runtime = "nodejs";

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const payload = parseUpdateOwnAccountRequest(await request.json());
    const session = await updateOwnAccount(payload);
    const response = NextResponse.json(session);
    setAuthSessionCookie(response, { sessionExpiresAt: session.sessionExpiresAt });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
