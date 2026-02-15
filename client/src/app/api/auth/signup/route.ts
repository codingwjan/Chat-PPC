import { NextResponse } from "next/server";
import { parseAuthSignUpRequest } from "@/server/contracts";
import { setAuthSessionCookie } from "@/server/auth-cookie";
import { handleApiError } from "@/server/http";
import { signUpAccount } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseAuthSignUpRequest(await request.json());
    const session = await signUpAccount(payload);
    const response = NextResponse.json(session, { status: 201 });
    setAuthSessionCookie(response, { sessionExpiresAt: session.sessionExpiresAt });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
