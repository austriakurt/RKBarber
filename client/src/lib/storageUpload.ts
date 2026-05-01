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
}

function compressImage(file: File, onCompress?: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size <= MAX_IMAGE_SIZE_BYTES) {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
      return;
    }

    if (onCompress) onCompress();

    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      const MAX_DIM = 2048;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas rendering context not supported"));
      
      ctx.drawImage(img, 0, 0, width, height);
      // WebP provides excellent compression, 0.7 is a good balance
      const dataUrl = canvas.toDataURL("image/webp", 0.7);
      
      // We could check if it's STILL > 3MB (base64 size), but 2048x2048 at 0.7 WebP is virtually guaranteed to be < 1MB
      resolve(dataUrl);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };
    
    img.src = url;
  });
}

export async function uploadImageFile(params: {
  file: File;
  folder: "gcash" | "proofs" | "barbers" | "gallery";
  prefix: string;
  onCompress?: () => void;
}): Promise<string> {
  const { file, folder, prefix, onCompress } = params;
  validateImageFile(file);

  const safeFileName = sanitizeFileName(file.name || "image");
  const dataUrl = await compressImage(file, onCompress);
  
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
