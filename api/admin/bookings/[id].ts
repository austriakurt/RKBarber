import { getFirebaseAdminServices } from "../../../server/vercel/firebaseAdmin.js";
import {
  buildBookingCompletionRequestEmailHtml,
  buildBookingStatusEmailHtml,
  createActionToken,
  getBaseUrl,
  getBookingCompletionRequestEmailSubject,
  getForceCompleteEligibleAtIso,
  getBookingStatusEmailSubject,
  hashActionToken,
  sendBookingActionEmail,
  type BookingEmailStatus,
} from "../../../server/vercel/bookingUtils.js";

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

  const id = String(req.query?.id || "").trim();
  if (!id) {
    res.status(400).json({ message: "Missing booking id" });
    return;
  }

  try {
    const { adminDb } = getFirebaseAdminServices();
    if (req.method === "PATCH") {
      const bookingRef = adminDb.collection("bookings").doc(id);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      const existing = bookingSnap.data() as Record<string, any>;
      const payload = req.body || {};
      const status = payload.status;
      const date = typeof payload.date === "string" ? payload.date.trim() : "";
      const time = typeof payload.time === "string" ? payload.time.trim() : "";

      const hasStatus = typeof status === "string" && status.length > 0;
      const hasReschedule = date.length > 0 || time.length > 0;
      if (!hasStatus && !hasReschedule) {
        res.status(400).json({ message: "No fields provided" });
        return;
      }

      if (hasStatus) {
        const allowed = new Set(["pending", "confirmed", "cancelled", "completed"]);
        if (!allowed.has(status)) {
          res.status(400).json({ message: "Invalid booking status" });
          return;
        }
      }

      const updates: Record<string, unknown> = {};
      if (hasStatus) updates.status = status;
      if (date.length > 0) updates.date = date;
      if (time.length > 0) updates.time = time;

      if (status === "completed" && existing.type === "reservation" && existing.customerDecision !== "accepted") {
        const eligibleAtRaw = String(existing.customerActionDeadline || "").trim();
        const eligibleAtMs = eligibleAtRaw ? Date.parse(eligibleAtRaw) : Number.NaN;
        const nowMs = Date.now();
        if (existing.customerActionRequired === true && Number.isFinite(eligibleAtMs) && nowMs < eligibleAtMs) {
          res.status(409).json({
            message: "Client completion is still pending. Force-complete becomes available after the configured waiting time.",
          });
          return;
        }
      }
      if (status === "confirmed" && existing.type === "reservation" && String(existing.status || "") === "completed") {
        res.status(409).json({ message: "Completed bookings cannot be moved back to confirmed." });
        return;
      }

      const nowIso = new Date().toISOString();
      let notificationStatus: BookingEmailStatus | null = null;

      if (hasReschedule) {
        updates.status = "confirmed";
        updates.customerDecision = "reschedule_requested";
        updates.customerDecisionAt = nowIso;
        updates.customerActionRequired = false;
        updates.customerActionDeadline = "";
        updates.customerTokenHash = "";
        updates.completionRequestedAt = "";
        updates.completionConfirmedAt = "";
        updates.completedBy = "";
        updates.forceCompletedAt = "";
        notificationStatus = "rescheduled";
      } else if (status === "confirmed") {
        const completionToken = createActionToken();
        const forceEligibleAt = getForceCompleteEligibleAtIso(new Date());
        updates.customerDecision = "accepted";
        updates.customerDecisionAt = nowIso;
        updates.customerActionRequired = true;
        updates.customerActionDeadline = forceEligibleAt;
        updates.customerTokenHash = hashActionToken(completionToken);
        updates.completionRequestedAt = nowIso;
        updates.completionConfirmedAt = "";
        updates.completedBy = "";
        updates.forceCompletedAt = "";

        const toEmail = String(existing.email || "").trim();
        if (toEmail.includes("@")) {
          const html = buildBookingCompletionRequestEmailHtml({
            baseUrl: getBaseUrl(req),
            token: completionToken,
            bookingId: id,
            customerName: String(existing.customerName || "Customer"),
            serviceName: String(existing.serviceName || ""),
            barberName: String(existing.barberName || ""),
            date: date.length > 0 ? date : String(existing.date || ""),
            time: time.length > 0 ? time : String(existing.time || ""),
            price: Number(existing.price || 0),
          });

          let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: "Completion email not sent" };
          try {
            emailResult = await sendBookingActionEmail({
              to: toEmail,
              subject: getBookingCompletionRequestEmailSubject(),
              html,
            });
          } catch (error) {
            emailResult = {
              sent: false,
              reason: error instanceof Error ? error.message : "Failed to send completion request email",
            };
          }

          updates.emailNotificationSent = emailResult.sent;
          updates.emailNotificationError = emailResult.reason || "";
        } else {
          updates.emailNotificationSent = false;
          updates.emailNotificationError = "Missing client email for completion request";
        }
      } else if (status === "cancelled") {
        updates.customerDecision = "cancelled";
        updates.customerDecisionAt = nowIso;
        updates.customerActionRequired = false;
        updates.customerActionDeadline = "";
        updates.customerTokenHash = "";
        updates.completionRequestedAt = "";
        updates.completionConfirmedAt = "";
        updates.completedBy = "";
        updates.forceCompletedAt = "";
        notificationStatus = "cancelled";
      } else if (status === "completed") {
        if (existing.type === "reservation") {
          const eligibleAtRaw = String(existing.customerActionDeadline || "").trim();
          const eligibleAtMs = eligibleAtRaw ? Date.parse(eligibleAtRaw) : Number.NaN;
          const canForceComplete = existing.customerActionRequired === true && Number.isFinite(eligibleAtMs) && Date.now() >= eligibleAtMs;
          updates.customerActionRequired = false;
          updates.customerTokenHash = "";
          updates.customerActionDeadline = "";
          updates.completionConfirmedAt = nowIso;
          updates.completedBy = canForceComplete ? "admin" : String(existing.completedBy || "client") || "admin";
          updates.forceCompletedAt = canForceComplete ? nowIso : "";
        }
        notificationStatus = "completed";
      }

      if (hasReschedule) {
        updates.rescheduledAt = nowIso;
      }

      await bookingRef.set(updates, { merge: true });

      let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: "No status email sent" };
      const toEmail = String(existing.email || "").trim();

      if (notificationStatus && toEmail.includes("@")) {
        const nextDate = date.length > 0 ? date : String(existing.date || "");
        const nextTime = time.length > 0 ? time : String(existing.time || "");

        const html = buildBookingStatusEmailHtml({
          customerName: String(existing.customerName || "Customer"),
          serviceName: String(existing.serviceName || ""),
          barberName: String(existing.barberName || ""),
          date: nextDate,
          time: nextTime,
          price: Number(existing.price || 0),
          status: notificationStatus,
          previousSchedule: hasReschedule
            ? {
                date: String(existing.date || ""),
                time: String(existing.time || ""),
              }
            : undefined,
        });

        try {
          emailResult = await sendBookingActionEmail({
            to: toEmail,
            subject: getBookingStatusEmailSubject(notificationStatus),
            html,
          });
        } catch (error) {
          emailResult = {
            sent: false,
            reason: error instanceof Error ? error.message : "Failed to send booking status email",
          };
        }

        await bookingRef.set(
          {
            emailNotificationSent: emailResult.sent,
            emailNotificationError: emailResult.reason || "",
          },
          { merge: true },
        );
      }

      res.status(200).json({ id, ...updates, emailSent: emailResult.sent, emailReason: emailResult.reason || "" });
      return;
    }

    if (req.method === "DELETE") {
      await adminDb.collection("bookings").doc(id).delete();
      res.status(204).send("");
      return;
    }

    res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("admin bookings mutation failed", error);
    const message = error instanceof Error ? error.message : "Booking operation failed";
    res.status(500).json({ message });
  }
}
