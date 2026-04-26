import { getFirebaseAdminServices } from "../../server/vercel/firebaseAdmin.js";

type BookingType = "reservation" | "walkin";

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  try {
    const payload = req.body || {};
    const type = String(payload.type || "") as BookingType;
    const barberId = String(payload.barberId || "").trim();
    const customerName = String(payload.customerName || "").trim();
    const phone = String(payload.phone || "").trim();
    const email = String(payload.email || "").trim();
    const date = String(payload.date || "").trim();
    const time = String(payload.time || "").trim();

    if (type !== "reservation" && type !== "walkin") {
      res.status(400).json({ message: "Invalid booking type" });
      return;
    }
    if (!barberId || !customerName || !phone || !date) {
      res.status(400).json({ message: "Missing required booking fields" });
      return;
    }
    if (!isValidPhone(phone)) {
      res.status(400).json({ message: "Invalid phone number" });
      return;
    }
    if (!email || !email.includes("@")) {
      res.status(400).json({ message: "Booking requires a valid email" });
      return;
    }

    const { adminDb } = getFirebaseAdminServices();
    const barberDoc = await adminDb.collection("barbers").doc(barberId).get();
    if (!barberDoc.exists) {
      res.status(400).json({ message: "Selected barber not found" });
      return;
    }
    const barber = barberDoc.data() as Record<string, unknown>;
    const barberName = String(barber.name || payload.barberName || "").trim();
    const price = type === "reservation" ? Number(barber.reservePrice || 0) : Number(barber.walkinPrice || 0);
    const paymentProofUrl = String(payload.paymentProofUrl || "").trim();

    if (type === "reservation" && price > 0 && !paymentProofUrl) {
      res.status(400).json({ message: "Reservation requires payment proof upload" });
      return;
    }

    if (type === "reservation") {
      const allBookingsSnapshot = await adminDb.collection("bookings").get();
      const isTaken = allBookingsSnapshot.docs.some((doc) => {
        const existing = doc.data() as Record<string, unknown>;
        const existingType = String(existing.type || "");
        const existingBarberId = String(existing.barberId || "");
        const existingDate = String(existing.date || "");
        const existingTime = String(existing.time || "");
        const existingStatus = String(existing.status || "");

        return (
          existingType === "reservation" &&
          existingBarberId === barberId &&
          existingDate === date &&
          existingTime === time &&
          (existingStatus === "pending" || existingStatus === "confirmed")
        );
      });

      if (isTaken) {
        res.status(409).json({ message: "Selected day and time is already taken" });
        return;
      }
    }

    const bookingData = {
      barberId,
      barberName,
      serviceId: String(payload.serviceId || ""),
      serviceName: String(payload.serviceName || ""),
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
      serviceNames: Array.isArray(payload.serviceNames) ? payload.serviceNames : [],
      customerName,
      phone,
      email,
      notes: String(payload.notes || ""),
      paymentProofUrl,
      date,
      time: type === "reservation" ? time : "",
      type,
      status: type === "reservation" ? "pending" : "confirmed",
      price,
      createdAt: new Date().toISOString(),
      customerDecision: type === "reservation" ? "awaiting" : "accepted",
      customerActionRequired: false,
      customerActionDeadline: "",
      customerDecisionAt: type === "reservation" ? "" : new Date().toISOString(),
      customerTokenHash: "",
      completionRequestedAt: "",
      completionConfirmedAt: "",
      completedBy: "",
      forceCompletedAt: "",
      emailNotificationSent: false,
      emailNotificationError: "",
    };

    const bookingRef = adminDb.collection("bookings").doc();
    await bookingRef.set(bookingData);

    const emailResult: { sent: boolean; reason?: string } = {
      sent: false,
      reason: type === "reservation"
        ? "Waiting for admin confirmation before sending completion email"
        : "Walk-in does not require email",
    };

    res.status(201).json({
      id: bookingRef.id,
      status: bookingData.status,
      price,
      emailSent: emailResult.sent,
      emailReason: emailResult.reason || "",
    });
  } catch (error) {
    console.error("booking create failed", error);
    const message = error instanceof Error ? error.message : "Booking create failed";
    res.status(500).json({ message });
  }
}