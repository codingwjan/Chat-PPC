import { NextResponse } from "next/server";
import { clearAuthSessionCookie, setAuthSessionCookie } from "@/server/auth-cookie";
import { parseLoginRequest } from "@/server/contracts";
import { AppError } from "@/server/errors";
import { handleApiError } from "@/server/http";
import { restoreSession } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseLoginRequest(await request.json());
    const user = await restoreSession(payload);
    const response = NextResponse.json(user);
    setAuthSessionCookie(response, { sessionExpiresAt: user.sessionExpiresAt });
    return response;
  } catch (error) {
    const response = handleApiError(error);
    if (error instanceof AppError && error.status === 401) {
      clearAuthSessionCookie(response);
    }
    return response;
  }
}
