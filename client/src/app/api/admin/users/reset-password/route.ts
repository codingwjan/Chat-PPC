import { NextResponse } from "next/server";
import { parseAdminResetUserPasswordRequest } from "@/server/contracts";
import { adminResetUserPassword } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseAdminResetUserPasswordRequest(await request.json());
    const result = await adminResetUserPassword(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
