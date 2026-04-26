import {
  buildBookingStatusEmailHtml,
  actionResultWithBackHtml,
  getBaseUrl,
  getBookingStatusEmailSubject,
  hashActionToken,
  sendBookingActionEmail,
} from "../../server/vercel/bookingUtils.js";
import { getFirebaseAdminServices } from "../../server/vercel/firebaseAdmin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const baseUrl = getBaseUrl(req);

  try {
    const rawAction = String(req.query?.action || req.query?.decision || req.body?.action || req.body?.decision || "")
      .trim()
      .toLowerCase();
    const action = rawAction === "approve" || rawAction === "accept"
      ? "confirm"
      : rawAction === "cancel"
        ? "decline"
        : rawAction;
    const token = String(req.query?.token || req.query?.t || req.body?.token || req.body?.t || "").trim();
    const bookingId = String(req.query?.bookingId || req.query?.id || req.body?.bookingId || req.body?.id || "").trim();

    if (!bookingId || !token || (action !== "confirm" && action !== "decline" && action !== "complete")) {
      res.status(400).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Invalid Action Link",
          message: "This booking action link is incomplete or invalid.",
          ok: false,
          baseUrl,
        }),
      );
      return;
    }

    const { adminDb } = getFirebaseAdminServices();
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const snapshot = await bookingRef.get();
    if (!snapshot.exists) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Booking Not Found",
          message: "This booking record no longer exists.",
          ok: false,
          baseUrl,
        }),
      );
      return;
    }

    const booking = snapshot.data() as Record<string, unknown>;
    const storedHash = String(booking.customerTokenHash || "");
    if (!storedHash || storedHash !== hashActionToken(token)) {
      res.status(403).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Link Not Valid",
          message: "This booking action link has expired or is no longer valid.",
          ok: false,
          baseUrl,
        }),
      );
      return;
    }

    if (booking.customerActionRequired === false || String(booking.status || "") === "completed") {
      const alreadyMessage = action === "complete"
        ? "This booking is already marked as completed."
        : "This booking action was already completed.";
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Already Processed",
          message: alreadyMessage,
          ok: true,
          baseUrl,
        }),
      );
      return;
    }

    const nowIso = new Date().toISOString();
    const isCompletionAction = action === "complete";
    const isLegacyDecision = action === "confirm" || action === "decline";

    if (isLegacyDecision && String(booking.status || "") !== "pending") {
      res.status(409).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Link Not Applicable",
          message: "This link is for a previous booking flow and can no longer be used.",
          ok: false,
          baseUrl,
        }),
      );
      return;
    }

    if (isCompletionAction && String(booking.status || "") !== "confirmed") {
      res.status(409).setHeader("Content-Type", "text/html; charset=utf-8").send(
        actionResultWithBackHtml({
          title: "Completion Not Available",
          message: "This booking is not in a confirmable state for completion.",
          ok: false,
          baseUrl,
        }),
      );
      return;
    }

    const patch = isCompletionAction
      ? {
          status: "completed",
          customerActionRequired: false,
          customerTokenHash: "",
          completionConfirmedAt: nowIso,
          completedBy: "client",
          forceCompletedAt: "",
        }
      : {
          customerDecision: action === "confirm" ? "accepted" : "cancelled",
          customerDecisionAt: nowIso,
          customerActionRequired: false,
          customerTokenHash: "",
          status: action === "confirm" ? "confirmed" : "cancelled",
        };

    await bookingRef.set(patch, { merge: true });

    let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: "No status email sent" };
    const toEmail = String(booking.email || "").trim();
    if (toEmail.includes("@")) {
      const emailStatus = isCompletionAction ? "completed" : action === "confirm" ? "approved" : "cancelled";
      const html = buildBookingStatusEmailHtml({
        customerName: String(booking.customerName || "Customer"),
        serviceName: String(booking.serviceName || ""),
        barberName: String(booking.barberName || ""),
        date: String(booking.date || ""),
        time: String(booking.time || ""),
        price: Number(booking.price || 0),
        status: emailStatus,
      });

      try {
        emailResult = await sendBookingActionEmail({
          to: toEmail,
          subject: getBookingStatusEmailSubject(emailStatus),
          html,
        });
      } catch (error) {
        emailResult = {
          sent: false,
          reason: error instanceof Error ? error.message : "Failed to send booking action result email",
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

    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(
      actionResultWithBackHtml({
        title: isCompletionAction ? "Service Completion Confirmed" : action === "confirm" ? "Booking Confirmed" : "Booking Declined",
        message: isCompletionAction
          ? "Thank you. Your booking has been marked as completed."
          : action === "confirm"
            ? "Thank you. Your booking is now confirmed and ready for service."
            : "Your booking has been declined. If you still need a slot, please make a new reservation.",
        ok: isCompletionAction ? true : action === "confirm",
        baseUrl,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Booking action failed";
    res.status(500).setHeader("Content-Type", "text/html; charset=utf-8").send(
      actionResultWithBackHtml({
        title: "Action Failed",
        message,
        ok: false,
        baseUrl,
      }),
    );
  }
}