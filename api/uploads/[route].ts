import { uploadToFreeHost, type ImageUploadPayload } from "../../server/vercel/imageUpload.js";

const ALLOWED_UPLOAD_HOSTS = new Set([
  "res.cloudinary.com",
]);

function isValidUploadPayload(payload: any): payload is ImageUploadPayload {
  const folderOk = !payload?.folder || ["gcash", "proofs", "barbers"].includes(String(payload.folder));
  return (
    payload &&
    typeof payload.dataUrl === "string" &&
    payload.dataUrl.length > 0 &&
    folderOk &&
    (payload.filename === undefined || typeof payload.filename === "string")
  );
}

function sanitizeDownloadFilename(fileName: string): string {
  return fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "download-file";
}

function parseAndValidateRemoteUrl(urlValue: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error("Invalid download URL");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Only HTTP(S) download URLs are allowed");
  }

  if (!ALLOWED_UPLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Download host is not allowed");
  }

  return parsed;
}

function getRoute(req: any): string {
  const value = req.query?.route;
  if (Array.isArray(value)) return String(value[0] || "").trim().toLowerCase();
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req: any, res: any) {
  const route = getRoute(req);

  if (route === "image") {
    if (req.method !== "POST") {
      res.status(405).json({ message: "Method not allowed" });
      return;
    }

    try {
      const payload = req.body || {};
      if (!isValidUploadPayload(payload)) {
        res.status(400).json({ message: "Invalid upload payload" });
        return;
      }

      const url = await uploadToFreeHost(payload);
      res.status(200).json({ url });
      return;
    } catch (error) {
      console.error("image upload failed", error);
      const message = error instanceof Error ? error.message : "Image upload failed";
      res.status(502).json({ message });
      return;
    }
  }

  if (route === "download") {
    if (req.method !== "GET") {
      res.status(405).send("Method not allowed");
      return;
    }

    try {
      const rawUrl = String(req.query?.url || "").trim();
      const fileName = sanitizeDownloadFilename(String(req.query?.filename || "download-file"));
      if (!rawUrl) {
        res.status(400).send("Missing 'url' query parameter");
        return;
      }

      const parsedUrl = parseAndValidateRemoteUrl(rawUrl);
      const upstream = await fetch(parsedUrl.toString());
      if (!upstream.ok) {
        res.status(502).send("Failed to fetch remote file");
        return;
      }

      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const data = Buffer.from(await upstream.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.status(200).send(data);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      res.status(400).send(message);
      return;
    }
  }

  res.status(404).json({ message: "Route not found" });
}