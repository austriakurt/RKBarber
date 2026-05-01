import {
  buildBookingStatusEmailHtml,
  actionResultWithBackHtml,
  getBaseUrl,
  getBookingStatusEmailSubject,
  hashActionToken,
  sendBookingActionEmail,
} from '../../server/vercel/bookingUtils.js';
import { getFirebaseAdminServices } from '../../server/vercel/firebaseAdmin.js';

// ─── Helper to extract path segments from the catch-all ───
function getPathSegments(req: any): string[] {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.map((s: any) => String(s).trim());
  if (typeof raw === 'string') return raw.split('/').map((s) => s.trim()).filter(Boolean);
  // Fallback: parse from URL
  const url = String(req.url || '');
  const match = url.match(/\/api\/bookings\/(.+?)(\?|$)/);
  if (match) return match[1].split('/').filter(Boolean);
  return [];
}

// ─── Create booking handler (POST /api/bookings) ───
type BookingType = 'reservation' | 'walkin';

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
}

async function handleCreateBooking(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const payload = req.body || {};
  const type = String(payload.type || '') as BookingType;
  const barberId = String(payload.barberId || '').trim();
  const customerName = String(payload.customerName || '').trim();
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  const date = String(payload.date || '').trim();
  const time = String(payload.time || '').trim();

  if (type !== 'reservation' && type !== 'walkin') {
    res.status(400).json({ message: 'Invalid booking type' });
    return;
  }
  if (!barberId || !customerName || !phone || !date) {
    res.status(400).json({ message: 'Missing required booking fields' });
    return;
  }
  if (!isValidPhone(phone)) {
    res.status(400).json({ message: 'Invalid phone number' });
    return;
  }
  if (!email || !email.includes('@')) {
    res.status(400).json({ message: 'Booking requires a valid email' });
    return;
  }

  const { adminDb } = getFirebaseAdminServices();
  const barberDoc = await adminDb.collection('barbers').doc(barberId).get();
  if (!barberDoc.exists) {
    res.status(400).json({ message: 'Selected barber not found' });
    return;
  }
  const barber = barberDoc.data() as Record<string, unknown>;
  const barberName = String(barber.name || payload.barberName || '').trim();
  const price = type === 'reservation' ? Number(barber.reservePrice || 0) : Number(barber.walkinPrice || 0);
  const paymentProofUrl = String(payload.paymentProofUrl || '').trim();

  if (type === 'reservation' && price > 0 && !paymentProofUrl) {
    res.status(400).json({ message: 'Reservation requires payment proof upload' });
    return;
  }

  if (type === 'reservation') {
    const allBookingsSnapshot = await adminDb.collection('bookings').get();
    const isTaken = allBookingsSnapshot.docs.some((doc: any) => {
      const existing = doc.data() as Record<string, unknown>;
      const existingType = String(existing.type || '');
      const existingBarberId = String(existing.barberId || '');
      const existingDate = String(existing.date || '');
      const existingTime = String(existing.time || '');
      const existingStatus = String(existing.status || '');

      return (
        existingType === 'reservation' &&
        existingBarberId === barberId &&
        existingDate === date &&
        existingTime === time &&
        (existingStatus === 'pending' || existingStatus === 'confirmed')
      );
    });

    if (isTaken) {
      res.status(409).json({ message: 'Selected day and time is already taken' });
      return;
    }
  }

  const bookingData = {
    barberId,
    barberName,
    serviceId: String(payload.serviceId || ''),
    serviceName: String(payload.serviceName || ''),
    serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
    serviceNames: Array.isArray(payload.serviceNames) ? payload.serviceNames : [],
    customerName,
    phone,
    email,
    notes: String(payload.notes || ''),
    paymentProofUrl,
    date,
    time: type === 'reservation' ? time : '',
    type,
    status: type === 'reservation' ? 'pending' : 'confirmed',
    price,
    createdAt: new Date().toISOString(),
    customerDecision: type === 'reservation' ? 'awaiting' : 'accepted',
    customerActionRequired: false,
    customerActionDeadline: '',
    customerDecisionAt: type === 'reservation' ? '' : new Date().toISOString(),
    customerTokenHash: '',
    completionRequestedAt: '',
    completionConfirmedAt: '',
    completedBy: '',
    forceCompletedAt: '',
    emailNotificationSent: false,
    emailNotificationError: '',
  };

  const bookingRef = adminDb.collection('bookings').doc();
  await bookingRef.set(bookingData);

  const emailResult: { sent: boolean; reason?: string } = {
    sent: false,
    reason:
      type === 'reservation'
        ? 'Waiting for admin confirmation before sending completion email'
        : 'Walk-in does not require email',
  };

  res.status(201).json({
    id: bookingRef.id,
    status: bookingData.status,
    price,
    emailSent: emailResult.sent,
    emailReason: emailResult.reason || '',
  });
}

// ─── Action handler (GET/POST /api/bookings/action) ───
async function handleAction(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const baseUrl = getBaseUrl(req);

  const rawAction = String(req.query?.action || req.query?.decision || req.body?.action || req.body?.decision || '')
    .trim()
    .toLowerCase();
  const action =
    rawAction === 'approve' || rawAction === 'accept'
      ? 'confirm'
      : rawAction === 'cancel'
        ? 'decline'
        : rawAction;
  const token = String(req.query?.token || req.query?.t || req.body?.token || req.body?.t || '').trim();
  const bookingId = String(
    req.query?.bookingId || req.query?.id || req.body?.bookingId || req.body?.id || ''
  ).trim();

  if (!bookingId || !token || (action !== 'confirm' && action !== 'decline' && action !== 'complete')) {
    res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Invalid Action Link',
          message: 'This booking action link is incomplete or invalid.',
          ok: false,
          baseUrl,
        })
      );
    return;
  }

  const { adminDb } = getFirebaseAdminServices();
  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const snapshot = await bookingRef.get();
  if (!snapshot.exists) {
    res
      .status(404)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Booking Not Found',
          message: 'This booking record no longer exists.',
          ok: false,
          baseUrl,
        })
      );
    return;
  }

  const booking = snapshot.data() as Record<string, unknown>;
  const storedHash = String(booking.customerTokenHash || '');
  if (!storedHash || storedHash !== hashActionToken(token)) {
    res
      .status(403)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Link Not Valid',
          message: 'This booking action link has expired or is no longer valid.',
          ok: false,
          baseUrl,
        })
      );
    return;
  }

  if (booking.customerActionRequired === false || String(booking.status || '') === 'completed') {
    const alreadyMessage =
      action === 'complete'
        ? 'This booking is already marked as completed.'
        : 'This booking action was already completed.';
    res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Already Processed',
          message: alreadyMessage,
          ok: true,
          baseUrl,
        })
      );
    return;
  }

  const nowIso = new Date().toISOString();
  const isCompletionAction = action === 'complete';
  const isLegacyDecision = action === 'confirm' || action === 'decline';

  if (isLegacyDecision && String(booking.status || '') !== 'pending') {
    res
      .status(409)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Link Not Applicable',
          message: 'This link is for a previous booking flow and can no longer be used.',
          ok: false,
          baseUrl,
        })
      );
    return;
  }

  if (isCompletionAction && String(booking.status || '') !== 'confirmed') {
    res
      .status(409)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        actionResultWithBackHtml({
          title: 'Completion Not Available',
          message: 'This booking is not in a confirmable state for completion.',
          ok: false,
          baseUrl,
        })
      );
    return;
  }

  const patch = isCompletionAction
    ? {
        status: 'completed',
        customerActionRequired: false,
        customerTokenHash: '',
        completionConfirmedAt: nowIso,
        completedBy: 'client',
        forceCompletedAt: '',
      }
    : {
        customerDecision: action === 'confirm' ? 'accepted' : 'cancelled',
        customerDecisionAt: nowIso,
        customerActionRequired: false,
        customerTokenHash: '',
        status: action === 'confirm' ? 'confirmed' : 'cancelled',
      };

  await bookingRef.set(patch, { merge: true });

  let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: 'No status email sent' };
  const toEmail = String(booking.email || '').trim();
  if (toEmail.includes('@')) {
    const emailStatus = isCompletionAction ? 'completed' : action === 'confirm' ? 'approved' : 'cancelled';
    const html = buildBookingStatusEmailHtml({
      customerName: String(booking.customerName || 'Customer'),
      serviceName: String(booking.serviceName || ''),
      barberName: String(booking.barberName || ''),
      date: String(booking.date || ''),
      time: String(booking.time || ''),
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
        reason: error instanceof Error ? error.message : 'Failed to send booking action result email',
      };
    }

    await bookingRef.set(
      {
        emailNotificationSent: emailResult.sent,
        emailNotificationError: emailResult.reason || '',
      },
      { merge: true }
    );
  }

  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(
      actionResultWithBackHtml({
        title: isCompletionAction
          ? 'Service Completion Confirmed'
          : action === 'confirm'
            ? 'Booking Confirmed'
            : 'Booking Declined',
        message: isCompletionAction
          ? 'Thank you. Your booking has been marked as completed.'
          : action === 'confirm'
            ? 'Thank you. Your booking is now confirmed and ready for service.'
            : 'Your booking has been declined. If you still need a slot, please make a new reservation.',
        ok: isCompletionAction ? true : action === 'confirm',
        baseUrl,
      })
    );
}

// ─── Main catch-all handler ───
export default async function handler(req: any, res: any) {
  const segments = getPathSegments(req);
  const route = (segments[0] || '').toLowerCase();

  try {
    if (route === 'action') {
      await handleAction(req, res);
      return;
    }

    // Default: POST /api/bookings (create booking)
    if (!route || route === 'index') {
      await handleCreateBooking(req, res);
      return;
    }

    res.status(404).json({ message: 'Booking route not found' });
  } catch (error) {
    console.error('booking operation failed', error);

    // If this was the action route, return HTML error
    if (route === 'action') {
      const baseUrl = getBaseUrl(req);
      const message = error instanceof Error ? error.message : 'Booking action failed';
      res
        .status(500)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          actionResultWithBackHtml({
            title: 'Action Failed',
            message,
            ok: false,
            baseUrl,
          })
        );
      return;
    }

    const message = error instanceof Error ? error.message : 'Booking operation failed';
    res.status(500).json({ message });
  }
}
