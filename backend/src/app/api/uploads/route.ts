import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createUploadUrl, StorageValidationError } from "@/lib/storage";
import { z } from "zod";

const UploadRequestSchema = z.object({
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

/**
 * Step 1 of the upload flow: the frontend calls this to get a presigned URL,
 * then PUTs the file bytes directly to storage (never through this server —
 * avoids routing photos through a serverless function's body-size limit).
 * The returned `key` is what gets submitted as RawInput.fileUrl in the
 * follow-up POST /api/inputs call.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { mimeType, sizeBytes } = UploadRequestSchema.parse(await req.json());
    const { key, uploadUrl } = await createUploadUrl(session.companyId, mimeType, sizeBytes);
    return NextResponse.json({ key, uploadUrl });
  } catch (err) {
    if (err instanceof StorageValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }
}
