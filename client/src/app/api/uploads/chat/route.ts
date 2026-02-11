import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { handleApiError } from "@/server/http";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for chat images
const MAX_INLINE_DATA_URL_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extensionFor(type: string): string {
    if (type === "image/jpeg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    if (type === "image/gif") return "gif";
    return "bin";
}

export async function POST(request: Request): Promise<NextResponse> {
    try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            throw new AppError("Image file is required", 400);
        }

        if (!ALLOWED_MIME_TYPES.has(file.type)) {
            throw new AppError("Only jpg, png, webp, or gif images are supported", 400);
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            throw new AppError("Image must be 10MB or smaller", 400);
        }

        if (!process.env.BLOB_READ_WRITE_TOKEN) {
            if (file.size > MAX_INLINE_DATA_URL_BYTES) {
                throw new AppError(
                    "Blob storage is not configured. Upload an image up to 2MB or set BLOB_READ_WRITE_TOKEN.",
                    400,
                );
            }

            const bytes = Buffer.from(await file.arrayBuffer());
            const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
            return NextResponse.json({ url: dataUrl, storage: "inline" }, { status: 201 });
        }

        const baseName =
            file.name
                .replace(/\.[^/.]+$/, "")
                .replace(/[^a-zA-Z0-9._-]/g, "_")
                .slice(0, 40) || "chat_image";
        const path = `chat/${Date.now()}-${baseName}.${extensionFor(file.type)}`;

        const blob = await put(path, file, {
            access: "public",
            addRandomSuffix: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
            contentType: file.type,
        });

        return NextResponse.json({ url: blob.url, storage: "blob" }, { status: 201 });
    } catch (error) {
        return handleApiError(error);
    }
}
