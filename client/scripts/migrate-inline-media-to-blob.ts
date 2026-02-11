import "dotenv/config";
import { put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DATA_IMAGE_PREFIX = "data:image/";
const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
const MARKDOWN_DATA_IMAGE_PATTERN = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/gi;
const CHAT_BACKGROUND_CLIENT_ID = "__chatppc_chat_background__";

function extensionFor(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "image/svg+xml") return "svg";
  return "bin";
}

function parseFlags(argv: string[]): { write: boolean } {
  const normalized = new Set(argv.map((value) => value.trim()));
  return {
    write: normalized.has("--write"),
  };
}

function decodeDataImageUrl(url: string): { contentType: string; bytes: Buffer } | null {
  const match = url.match(DATA_URL_PATTERN);
  if (!match) return null;
  const contentType = match[1]?.toLowerCase() || "image/png";
  const base64 = (match[2] || "").replace(/\s+/g, "");
  if (!base64) return null;
  return {
    contentType,
    bytes: Buffer.from(base64, "base64"),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const token = (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB)?.trim();
  const dryRun = !flags.write;

  if (!dryRun && !token) {
    throw new Error("BLOB_READ_WRITE_TOKEN (or BLOB) is required when running with --write.");
  }

  const uploadedUrlBySource = new Map<string, string>();
  let userProfileUpdates = 0;
  let backgroundUpdates = 0;
  let authorAvatarUpdates = 0;
  let messageContentUpdates = 0;
  let skippedInvalidDataUrls = 0;
  let discoveredDataUrls = 0;

  const uploadDataUrl = async (scope: string, source: string): Promise<string | null> => {
    if (uploadedUrlBySource.has(source)) {
      return uploadedUrlBySource.get(source) || null;
    }

    const decoded = decodeDataImageUrl(source);
    if (!decoded || decoded.bytes.length === 0) {
      skippedInvalidDataUrls += 1;
      return null;
    }

    discoveredDataUrls += 1;
    if (dryRun) {
      return `dry-run://${scope}/${discoveredDataUrls}`;
    }

    const blob = await put(
      `${scope}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extensionFor(decoded.contentType)}`,
      decoded.bytes,
      {
        access: "public",
        addRandomSuffix: true,
        token,
        contentType: decoded.contentType,
      },
    );
    uploadedUrlBySource.set(source, blob.url);
    return blob.url;
  };

  const users = await prisma.user.findMany({
    where: {
      profilePicture: {
        startsWith: DATA_IMAGE_PREFIX,
      },
    },
    select: { id: true, clientId: true, profilePicture: true },
  });

  for (const user of users) {
    const nextUrl = await uploadDataUrl(
      user.clientId === CHAT_BACKGROUND_CLIENT_ID ? "chat-background" : "avatars",
      user.profilePicture,
    );
    if (!nextUrl) continue;

    if (!dryRun) {
      await prisma.user.update({
        where: { id: user.id },
        data: { profilePicture: nextUrl },
      });
    }

    if (user.clientId === CHAT_BACKGROUND_CLIENT_ID) {
      backgroundUpdates += 1;
    } else {
      userProfileUpdates += 1;
    }
  }

  const messageAvatars = await prisma.message.findMany({
    where: {
      authorProfilePicture: {
        startsWith: DATA_IMAGE_PREFIX,
      },
    },
    select: { id: true, authorProfilePicture: true },
  });

  for (const message of messageAvatars) {
    const nextUrl = await uploadDataUrl("message-avatars", message.authorProfilePicture);
    if (!nextUrl) continue;

    if (!dryRun) {
      await prisma.message.update({
        where: { id: message.id },
        data: { authorProfilePicture: nextUrl },
      });
    }

    authorAvatarUpdates += 1;
  }

  const messageContentRows = await prisma.message.findMany({
    where: {
      content: {
        contains: DATA_IMAGE_PREFIX,
      },
    },
    select: { id: true, content: true },
  });

  for (const row of messageContentRows) {
    const matches = [...row.content.matchAll(MARKDOWN_DATA_IMAGE_PATTERN)];
    if (matches.length === 0) continue;

    let nextContent = row.content;
    let changed = false;

    for (const match of matches) {
      const full = match[0];
      const alt = match[1] || "image";
      const dataUrl = match[2];
      if (!full || !dataUrl) continue;

      const nextUrl = await uploadDataUrl("messages", dataUrl);
      if (!nextUrl) continue;

      const replacement = `![${alt}](${nextUrl})`;
      if (replacement === full) continue;
      nextContent = nextContent.replace(full, replacement);
      changed = true;
    }

    if (!changed) continue;

    if (!dryRun) {
      await prisma.message.update({
        where: { id: row.id },
        data: { content: nextContent },
      });
    }

    messageContentUpdates += 1;
  }

  console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);
  console.log(`Users updated: ${userProfileUpdates}`);
  console.log(`Background updated: ${backgroundUpdates}`);
  console.log(`Message avatars updated: ${authorAvatarUpdates}`);
  console.log(`Message contents updated: ${messageContentUpdates}`);
  console.log(`Inline data URLs discovered: ${discoveredDataUrls}`);
  console.log(`Invalid inline data URLs skipped: ${skippedInvalidDataUrls}`);
}

main()
  .catch((error) => {
    console.error("Inline media migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
