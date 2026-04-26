import { getFirebaseAdminServices } from "../../server/vercel/firebaseAdmin.js";

type Claims = {
  admin?: boolean;
  role?: string;
  email?: string;
};

function parseEmailAllowlist(): Set<string> {
  const allowlist = (process.env.ADMIN_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const fallback = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return new Set([...allowlist, ...(fallback ? [fallback] : [])]);
}

function hasAdminRights(claims: Claims): boolean {
  if (claims.admin === true || claims.role === "admin") {
    return true;
  }

  const email = (claims.email || "").trim().toLowerCase();
  return email.length > 0 && parseEmailAllowlist().has(email);
}

async function requireAdmin(req: any): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const header = req.headers?.authorization || "";
  const [scheme, token] = String(header).split(" ");
  if (scheme !== "Bearer" || !token) {
    return { ok: false, status: 401, message: "Missing or invalid authorization header" };
  }

  try {
    const { adminAuth } = getFirebaseAdminServices();
    const decoded = await adminAuth.verifyIdToken(token, true);
    if (!hasAdminRights(decoded as Claims)) {
      return { ok: false, status: 403, message: "Admin role required" };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
}

export default async function handler(req: any, res: any) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    res.status(auth.status).json({ message: auth.message });
    return;
  }

  if (req.method !== "PATCH") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  try {
    const payload = req.body || {};
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: "No settings fields provided" });
      return;
    }

    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection("settings").doc("shop").set(payload, { merge: true });
    res.status(200).json(payload);
  } catch (error) {
    console.error("admin settings update failed", error);
    const message = error instanceof Error ? error.message : "Settings operation failed";
    res.status(500).json({ message });
  }
}
