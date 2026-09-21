import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Private object storage for photo/PDF uploads (spec §58: "private file
 * storage, signed file URLs"). Written against the S3 API so it works
 * unchanged with AWS S3, Cloudflare R2, Backblaze B2, or any other
 * S3-compatible provider — just point S3_ENDPOINT at the right host (or
 * leave it unset for real AWS S3).
 *
 * Flow: frontend calls POST /api/uploads to get a presigned PUT URL, uploads
 * the file directly to storage (never through the Next.js server — avoids
 * routing large photos through your API and hitting serverless body-size
 * limits), then submits the returned key as RawInput.fileUrl.
 */

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT, // unset = real AWS S3; set for R2/B2/etc.
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET!;

// Spec §58: file type validation. Matches what the extraction pipeline
// actually knows how to handle (pipeline.ts branches on PHOTO vs PDF).
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/pdf",
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — generous for a phone photo, well under most API limits

export class StorageValidationError extends Error {}

export function validateUpload(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new StorageValidationError(`Unsupported file type: ${mimeType}`);
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new StorageValidationError(`File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`);
  }
}

/** Generates a presigned PUT URL. Key is namespaced by company so one
 *  tenant's uploads can never collide with (or be guessed into) another's. */
export async function createUploadUrl(companyId: string, mimeType: string, sizeBytes: number): Promise<{ key: string; uploadUrl: string }> {
  validateUpload(mimeType, sizeBytes);

  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `${companyId}/${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes to complete the upload

  return { key, uploadUrl };
}

/** Fetches an object and returns it base64-encoded, for handing straight to
 *  the Claude API's image/document content blocks. This is what
 *  pipeline.ts's loadFileBase64() calls. */
export async function getObjectBase64(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes).toString("base64");
}

/** Signed, time-limited read URL — for displaying evidence (spec §72) in the
 *  UI without making the bucket itself public. */
export async function getReadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
