import { NextResponse } from "next/server";
import { parseAdminActionRequest, parseAdminOverviewRequest } from "@/server/contracts";
import { getAdminOverview, runAdminAction } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const payload = parseAdminOverviewRequest({
      clientId: searchParams.get("clientId"),
      devAuthToken: searchParams.get("devAuthToken"),
    });
    const overview = await getAdminOverview(payload);
    return NextResponse.json(overview);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = parseAdminActionRequest(await request.json());
    const result = await runAdminAction(payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
