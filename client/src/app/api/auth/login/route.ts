import { NextResponse } from "next/server";
import { parseLoginRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { loginUser } from "@/server/chat-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseLoginRequest(await request.json());
    const user = await loginUser(payload);
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}
