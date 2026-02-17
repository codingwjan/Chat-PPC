import { NextResponse } from "next/server";
import { parseAuthSignInRequest } from "@/server/contracts";
import { setAuthSessionCookie } from "@/server/auth-cookie";
import { handleApiError } from "@/server/http";
import { signInAccount } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseAuthSignInRequest(await request.json());
    const session = await signInAccount(payload);
    const response = NextResponse.json(session);
    setAuthSessionCookie(response, { sessionExpiresAt: session.sessionExpiresAt });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
