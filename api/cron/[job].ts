import {
  buildReservationReminderEmailHtml,
  getReservationReminderEmailSubject,
  sendBookingActionEmail,
} from "../../server/vercel/bookingUtils.js";
import { getFirebaseAdminServices } from "../../server/vercel/firebaseAdmin.js";

function canRunCron(req: any): boolean {
  const ua = String(req.headers?.["user-agent"] || "").toLowerCase();
  if (ua.includes("vercel-cron")) return true;

  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return true;

  const providedHeader = String(req.headers?.["x-cron-secret"] || "").trim();
  const providedQuery = String(req.query?.secret || "").trim();
  return providedHeader === expected || providedQuery === expected;
}

function getDateKeyAtOffset(offsetDays: number): string {
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);

  // Use Asia/Manila date so reminders align with shop local calendar.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

async function handleReminderCron(req: any, res: any) {
  try {
    const { adminDb } = getFirebaseAdminServices();
    const targetDate = getDateKeyAtOffset(1);
    const snapshot = await adminDb.collection("bookings").get();

    let checked = 0;
    let matched = 0;
    let sent = 0;
    let skippedNoEmail = 0;
    let skippedAlreadySent = 0;
    let failed = 0;

    for (const doc of snapshot.docs) {
      checked += 1;
      const booking = doc.data() as Record<string, unknown>;

      const type = String(booking.type || "");
      const status = String(booking.status || "");
      const date = String(booking.date || "");
      const email = String(booking.email || "").trim();
      const reminderSentForDate = String(booking.reminderSentForDate || "");

      const shouldNotify =
        type === "reservation" &&
        (status === "pending" || status === "confirmed") &&
        date === targetDate;

      if (!shouldNotify) continue;
      matched += 1;

      if (!email.includes("@")) {
        skippedNoEmail += 1;
        continue;
      }

      if (reminderSentForDate === targetDate) {
        skippedAlreadySent += 1;
        continue;
      }

      try {
        const html = buildReservationReminderEmailHtml({
          customerName: String(booking.customerName || "Customer"),
          serviceName: String(booking.serviceName || ""),
          barberName: String(booking.barberName || ""),
          date,
          time: String(booking.time || ""),
          price: Number(booking.price || 0),
        });

        const result = await sendBookingActionEmail({
          to: email,
          subject: getReservationReminderEmailSubject(),
          html,
        });

        if (result.sent) {
          await adminDb.collection("bookings").doc(doc.id).set(
            {
              reminderSentForDate: targetDate,
              reminderLastSentAt: new Date().toISOString(),
              reminderLastError: "",
            },
            { merge: true },
          );
          sent += 1;
        } else {
          await adminDb.collection("bookings").doc(doc.id).set(
            {
              reminderLastError: result.reason || "Failed to send reminder",
            },
            { merge: true },
          );
          failed += 1;
        }
      } catch (error) {
        await adminDb.collection("bookings").doc(doc.id).set(
          {
            reminderLastError: error instanceof Error ? error.message : "Failed to send reminder",
          },
          { merge: true },
        );
        failed += 1;
      }
    }

    res.status(200).json({
      job: "send-reservation-reminders",
      targetDate,
      checked,
      matched,
      sent,
      skippedNoEmail,
      skippedAlreadySent,
      failed,
    });
  } catch (error) {
    console.error("reservation reminder cron failed", error);
    const message = error instanceof Error ? error.message : "Reservation reminder cron failed";
    res.status(500).json({ message });
  }
}

async function handleExpireBookingsCron(_req: any, res: any) {
  res.status(200).json({
    checked: 0,
    cancelled: 0,
    disabled: true,
    reason: "Client-action expiration is disabled. Booking decisions are now admin-managed.",
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  if (!canRunCron(req)) {
    res.status(401).json({ message: "Unauthorized cron call" });
    return;
  }

  const job = String(req.query.job || "").trim();

  if (job === "send-reservation-reminders") {
    await handleReminderCron(req, res);
    return;
  }

  if (job === "expire-bookings") {
    await handleExpireBookingsCron(req, res);
    return;
  }

  res.status(404).json({ message: "Unknown cron job" });
}