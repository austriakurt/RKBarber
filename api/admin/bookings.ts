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
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    res.status(auth.status).json({ message: auth.message });
    return;
  }

  try {
    const { adminDb } = getFirebaseAdminServices();
    const date = String(req.query?.date || "").trim();
    const snapshot = await adminDb.collection("bookings").orderBy("createdAt", "desc").get();
    const bookings = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })) as Array<
      { id: string; date?: unknown } & Record<string, unknown>
    >;

    const filtered = date ? bookings.filter((booking) => booking.date === date) : bookings;
    res.status(200).json(filtered);
  } catch (error) {
    console.error("admin bookings GET failed", error);
    const message = error instanceof Error ? error.message : "Failed to load bookings";
    res.status(500).json({ message });
  }
}
