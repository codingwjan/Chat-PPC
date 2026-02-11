import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import type { LinkPreviewDTO } from "@/lib/types";
import { AppError } from "@/server/errors";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

const CACHE_CONTROL = "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";
const MAX_HTML_BYTES = 300_000;

function isPrivateIpAddress(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.replace("::ffff:", ""));
  }

  if (isIP(ip) !== 4) return false;
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

async function assertSafeHostname(hostname: string): Promise<void> {
  const lowerHostname = hostname.toLowerCase();
  if (lowerHostname === "localhost" || lowerHostname.endsWith(".local")) {
    throw new AppError("Local URLs are not allowed", 400);
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new AppError("Could not resolve URL host", 400);
  }

  for (const address of addresses) {
    if (isPrivateIpAddress(address.address)) {
      throw new AppError("Private network URLs are not allowed", 400);
    }
  }
}

function extractMeta(html: string, attr: "property" | "name", key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<meta[^>]*${attr}=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const match = html.match(regex);
  return match?.[1]?.trim() || null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || null;
}

function toAbsoluteUrl(baseUrl: string, value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function readHtmlWithLimit(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      const allowed = value.slice(0, value.byteLength - (total - MAX_HTML_BYTES));
      if (allowed.byteLength > 0) {
        chunks.push(allowed);
      }
      break;
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");
    if (!rawUrl) {
      throw new AppError("url query parameter is required", 400);
    }

    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new AppError("Only http(s) URLs are supported", 400);
    }

    await assertSafeHostname(parsedUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "Chat-PPC-LinkPreview/1.0",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    const html = contentType.includes("text/html") ? await readHtmlWithLimit(response) : "";

    const title =
      extractMeta(html, "property", "og:title") ||
      extractMeta(html, "name", "twitter:title") ||
      extractTitle(html);
    const description =
      extractMeta(html, "property", "og:description") || extractMeta(html, "name", "description");
    const image = toAbsoluteUrl(
      parsedUrl.toString(),
      extractMeta(html, "property", "og:image") || extractMeta(html, "name", "twitter:image"),
    );
    const siteName = extractMeta(html, "property", "og:site_name");

    const payload: LinkPreviewDTO = {
      url: parsedUrl.toString(),
      title,
      description,
      image,
      siteName,
      hostname: parsedUrl.hostname,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
