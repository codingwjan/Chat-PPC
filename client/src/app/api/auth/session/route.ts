import { NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/server/auth-cookie";

export const runtime = "nodejs";

export async function DELETE(): Promise<NextResponse> {
  const response = new NextResponse(null, { status: 204 });
  clearAuthSessionCookie(response);
  return response;
}
