import { NextResponse } from "next/server";
import { parseRenameUserRequest } from "@/server/contracts";
import { handleApiError } from "@/server/http";
import { renameUser } from "@/server/chat-service";

export const runtime = "nodejs";

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const payload = parseRenameUserRequest(await request.json());
    const user = await renameUser(payload);
    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}
