function sanitizeDownloadName(fileName: string): string {
  return fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "download-file";
}

export async function downloadImageInApp(url: string, filename: string): Promise<void> {
  const safeName = sanitizeDownloadName(filename);
  const response = await fetch(
    `/api/uploads/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`,
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "Download failed");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
