const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Only PNG, JPG, or WebP images are allowed");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image must be 3MB or smaller");
  }
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFile(params: {
  file: File;
  folder: "gcash" | "proofs" | "barbers" | "gallery";
  prefix: string;
}): Promise<string> {
  const { file, folder, prefix } = params;
  validateImageFile(file);

  const safeFileName = sanitizeFileName(file.name || "image");
  const dataUrl = await toDataUrl(file);
  const response = await fetch("/api/uploads/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataUrl,
      folder,
      filename: `${prefix}-${safeFileName}`,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };
  if (!response.ok) {
    throw new Error(String(body?.message || "Image upload failed"));
  }

  return String(body?.url || "");
}
