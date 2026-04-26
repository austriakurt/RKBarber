import crypto from "node:crypto";

const MAX_UPLOAD_SIZE_BYTES = 3 * 1024 * 1024;

type UploadFolder = "gcash" | "proofs" | "barbers";

export type ImageUploadPayload = {
  dataUrl: string;
  folder?: UploadFolder;
  filename?: string;
};

function sanitizeUploadFilename(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function parseImageDataUrl(dataUrl: string): { mimeType: "image/png" | "image/jpeg" | "image/webp" } {
  const m = String(dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    throw new Error("Invalid image format. Use PNG, JPG, or WebP");
  }

  const mimeType = m[1].toLowerCase() as "image/png" | "image/jpeg" | "image/webp";
  const base64 = m[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Uploaded image is empty");
  }
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("Image must be 3MB or smaller");
  }

  return { mimeType };
}

type CloudinaryConfig = {
  apiKey: string;
  apiSecret: string;
  cloudName: string;
};

function getCloudinaryConfig(): CloudinaryConfig {
  const raw = String(process.env.CLOUDINARY_URL || "").trim();
  if (!raw) {
    throw new Error("CLOUDINARY_URL is not configured");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CLOUDINARY_URL is invalid");
  }

  if (parsed.protocol !== "cloudinary:") {
    throw new Error("CLOUDINARY_URL must use the cloudinary:// protocol");
  }

  const apiKey = decodeURIComponent(parsed.username || "").trim();
  const apiSecret = decodeURIComponent(parsed.password || "").trim();
  const cloudName = decodeURIComponent(parsed.hostname || "").trim();
  if (!apiKey || !apiSecret || !cloudName) {
    throw new Error("CLOUDINARY_URL is missing api key, api secret, or cloud name");
  }

  return { apiKey, apiSecret, cloudName };
}

async function uploadViaCloudinary(dataUrl: string, fileName: string, folder?: UploadFolder): Promise<string> {
  const { apiKey, apiSecret, cloudName } = getCloudinaryConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const safeFolder = folder || "proofs";
  const publicId = sanitizeUploadFilename(fileName).replace(/\.[a-z0-9]+$/i, "");
  const signatureBase = `folder=${safeFolder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(signatureBase).digest("hex");

  const body = new URLSearchParams();
  body.set("file", dataUrl);
  body.set("folder", safeFolder);
  body.set("public_id", publicId);
  body.set("timestamp", timestamp);
  body.set("api_key", apiKey);
  body.set("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => null) as
    | { secure_url?: string; url?: string; error?: { message?: string } }
    | null;
  const url = String(payload?.secure_url || payload?.url || "").trim();
  if (!response.ok || !/^https?:\/\//i.test(url)) {
    throw new Error(payload?.error?.message || "cloudinary upload failed");
  }

  return url;
}

export async function uploadToFreeHost(payload: ImageUploadPayload): Promise<string> {
  const { mimeType } = parseImageDataUrl(payload.dataUrl);
  const ext = extensionFromMime(mimeType);
  const baseName = sanitizeUploadFilename(payload.filename || `image-${Date.now()}.${ext}`);
  const fileName = `${payload.folder || "proofs"}-${Date.now()}-${baseName}`;

  return uploadViaCloudinary(payload.dataUrl, fileName, payload.folder);
}
