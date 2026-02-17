import { NextResponse } from "next/server";
import { parseAdminUsersQueryRequest } from "@/server/contracts";
import { getAdminUsers } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseAdminUsersQueryRequest({
      clientId: searchParams.get("clientId"),
      devAuthToken: searchParams.get("devAuthToken"),
    });
    const users = await getAdminUsers(payload);
    return NextResponse.json(users);
  } catch (error) {
    return handleApiError(error);
  }
}
