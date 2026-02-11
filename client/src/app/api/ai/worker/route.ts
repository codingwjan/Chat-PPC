import { NextResponse } from "next/server";
import { processAiQueue } from "@/server/chat-service";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMaxJobs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(20, parsed));
}

function isAuthorized(request: Request): boolean {
  const configured = process.env.AI_WORKER_TOKEN?.trim();
  if (!configured) return true;

  const auth = request.headers.get("authorization") || "";
  const tokenFromHeader = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice("bearer ".length).trim()
    : null;
  const tokenFromQuery = new URL(request.url).searchParams.get("token");

  return tokenFromHeader === configured || tokenFromQuery === configured;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const maxJobs = parseMaxJobs(searchParams.get("maxJobs"));
    const result = await processAiQueue({ maxJobs });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as { maxJobs?: number } | null;
    const maxJobs = Number.isFinite(payload?.maxJobs)
      ? Math.max(1, Math.min(20, Number(payload?.maxJobs)))
      : undefined;
    const result = await processAiQueue({ maxJobs });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
