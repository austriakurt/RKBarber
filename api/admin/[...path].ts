import { getFirebaseAdminServices } from '../../server/vercel/firebaseAdmin.js';
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
} from '../../server/vercel/bookingUtils.js';

type Claims = {
  admin?: boolean;
  role?: string;
  email?: string;
};

function parseEmailAllowlist(): Set<string> {
  const allowlist = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const fallback = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return new Set([...allowlist, ...(fallback ? [fallback] : [])]);
}

function hasAdminRights(claims: Claims): boolean {
  if (claims.admin === true || claims.role === 'admin') {
    return true;
  }

  const email = (claims.email || '').trim().toLowerCase();
  return email.length > 0 && parseEmailAllowlist().has(email);
}

async function requireAdmin(
  req: any
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const header = req.headers?.authorization || '';
  const [scheme, token] = String(header).split(' ');
  if (scheme !== 'Bearer' || !token) {
    return {
      ok: false,
      status: 401,
      message: 'Missing or invalid authorization header',
    };
  }

  try {
    const { adminAuth } = getFirebaseAdminServices();
    const decoded = await adminAuth.verifyIdToken(token, true);
    if (!hasAdminRights(decoded as Claims)) {
      return { ok: false, status: 403, message: 'Admin role required' };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
}

// ─── Helper to extract path segments from the catch-all ───
function getPathSegments(req: any): string[] {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.map((s: any) => String(s).trim());
  if (typeof raw === 'string') return raw.split('/').map((s) => s.trim()).filter(Boolean);
  // Fallback: parse from URL
  const url = String(req.url || '');
  const match = url.match(/\/api\/admin\/(.+?)(\?|$)/);
  if (match) return match[1].split('/').filter(Boolean);
  return [];
}

// ─── Barbers handler ───
async function handleBarbers(req: any, res: any, segments: string[]) {
  const id = segments[1] || '';

  if (req.method === 'POST' && !id) {
    const payload = req.body || {};
    if (!payload.name || typeof payload.name !== 'string') {
      res.status(400).json({ message: 'Invalid barber payload' });
      return;
    }
    const { adminDb } = getFirebaseAdminServices();
    const created = await adminDb.collection('barbers').add(payload);
    res.status(201).json({ id: created.id, ...payload });
    return;
  }

  if (req.method === 'PATCH' && id) {
    const payload = req.body || {};
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: 'No barber fields provided' });
      return;
    }
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('barbers').doc(id).set(payload, { merge: true });
    res.status(200).json({ id, ...payload });
    return;
  }

  if (req.method === 'DELETE' && id) {
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('barbers').doc(id).delete();
    res.status(204).send('');
    return;
  }

  res.status(405).json({ message: 'Method not allowed' });
}

// ─── Gallery handler ───
async function handleGallery(req: any, res: any, segments: string[]) {
  const id = segments[1] || '';

  if (req.method === 'POST' && !id) {
    const data = {
      imageUrl: String(req.body?.imageUrl || ''),
      caption: String(req.body?.caption || ''),
      order: Number(req.body?.order ?? Date.now()),
      createdAt: new Date().toISOString(),
    };

    if (!data.imageUrl) {
      res.status(400).json({ message: 'imageUrl is required' });
      return;
    }

    const { adminDb } = getFirebaseAdminServices();
    const created = await adminDb.collection('gallery').add(data);
    res.status(201).json({ id: created.id, ...data });
    return;
  }

  if (req.method === 'PATCH' && id) {
    const payload = req.body || {};
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: 'No gallery fields provided' });
      return;
    }
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('gallery').doc(id).set(payload, { merge: true });
    res.status(200).json({ id, ...payload });
    return;
  }

  if (req.method === 'DELETE' && id) {
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('gallery').doc(id).delete();
    res.status(204).send('');
    return;
  }

  res.status(405).json({ message: 'Method not allowed' });
}

// ─── Services handler ───
async function handleServices(req: any, res: any, segments: string[]) {
  const id = segments[1] || '';

  if (req.method === 'POST' && !id) {
    const payload = req.body || {};
    if (!payload.name || typeof payload.name !== 'string') {
      res.status(400).json({ message: 'Invalid service payload' });
      return;
    }
    const { adminDb } = getFirebaseAdminServices();
    const created = await adminDb.collection('services').add(payload);
    res.status(201).json({ id: created.id, ...payload });
    return;
  }

  if (req.method === 'PATCH' && id) {
    const payload = req.body || {};
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: 'No service fields provided' });
      return;
    }
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('services').doc(id).set(payload, { merge: true });
    res.status(200).json({ id, ...payload });
    return;
  }

  if (req.method === 'DELETE' && id) {
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('services').doc(id).delete();
    res.status(204).send('');
    return;
  }

  res.status(405).json({ message: 'Method not allowed' });
}

// ─── Settings handler ───
async function handleSettings(req: any, res: any) {
  if (req.method !== 'PATCH') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const payload = req.body || {};
  if (Object.keys(payload).length === 0) {
    res.status(400).json({ message: 'No settings fields provided' });
    return;
  }

  const { adminDb } = getFirebaseAdminServices();
  await adminDb.collection('settings').doc('shop').set(payload, { merge: true });
  res.status(200).json(payload);
}

// ─── Queue handler ───
async function handleQueue(req: any, res: any, segments: string[]) {
  const id = segments[1] || '';

  if (!id) {
    res.status(400).json({ message: 'Missing queue id' });
    return;
  }

  const { adminDb } = getFirebaseAdminServices();

  if (req.method === 'PATCH') {
    const payload = req.body || {};
    const updates: Record<string, unknown> = {};

    if (typeof payload.status === 'string') {
      const allowed = new Set(['waiting', 'in-progress', 'done']);
      if (!allowed.has(payload.status)) {
        res.status(400).json({ message: 'Invalid queue status' });
        return;
      }
      updates.status = payload.status;
    }

    if (payload.position !== undefined) {
      if (!Number.isInteger(payload.position) || Number(payload.position) <= 0) {
        res.status(400).json({ message: 'Invalid queue position' });
        return;
      }
      updates.position = Number(payload.position);
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: 'No valid queue fields provided' });
      return;
    }

    await adminDb.collection('queue').doc(id).set(updates, { merge: true });
    res.status(200).json({ id, ...updates });
    return;
  }

  if (req.method === 'DELETE') {
    await adminDb.collection('queue').doc(id).delete();
    res.status(204).send('');
    return;
  }

  res.status(405).json({ message: 'Method not allowed' });
}

// ─── Bookings (admin) handler ───
async function handleBookings(req: any, res: any, segments: string[]) {
  const id = segments[1] || '';

  // GET /api/admin/bookings  → list bookings
  if (req.method === 'GET' && !id) {
    const { adminDb } = getFirebaseAdminServices();
    const date = String(req.query?.date || '').trim();
    const snapshot = await adminDb.collection('bookings').orderBy('createdAt', 'desc').get();
    const bookings = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    })) as Array<{ id: string; date?: unknown } & Record<string, unknown>>;

    const filtered = date ? bookings.filter((booking) => booking.date === date) : bookings;
    res.status(200).json(filtered);
    return;
  }

  // PATCH /api/admin/bookings/:id
  if (req.method === 'PATCH' && id) {
    const { adminDb } = getFirebaseAdminServices();
    const bookingRef = adminDb.collection('bookings').doc(id);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const existing = bookingSnap.data() as Record<string, any>;
    const payload = req.body || {};
    const status = payload.status;
    const date = typeof payload.date === 'string' ? payload.date.trim() : '';
    const time = typeof payload.time === 'string' ? payload.time.trim() : '';

    const hasStatus = typeof status === 'string' && status.length > 0;
    const hasReschedule = date.length > 0 || time.length > 0;
    if (!hasStatus && !hasReschedule) {
      res.status(400).json({ message: 'No fields provided' });
      return;
    }

    if (hasStatus) {
      const allowed = new Set(['pending', 'confirmed', 'cancelled', 'completed']);
      if (!allowed.has(status)) {
        res.status(400).json({ message: 'Invalid booking status' });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (hasStatus) updates.status = status;
    if (date.length > 0) updates.date = date;
    if (time.length > 0) updates.time = time;


    if (status === 'confirmed' && existing.type === 'reservation' && String(existing.status || '') === 'completed') {
      res.status(409).json({ message: 'Completed bookings cannot be moved back to confirmed.' });
      return;
    }

    const nowIso = new Date().toISOString();
    let notificationStatus: BookingEmailStatus | null = null;

    if (hasReschedule) {
      updates.status = 'confirmed';
      updates.customerDecision = 'reschedule_requested';
      updates.customerDecisionAt = nowIso;
      updates.customerActionRequired = false;
      updates.customerActionDeadline = '';
      updates.customerTokenHash = '';
      updates.completionRequestedAt = '';
      updates.completionConfirmedAt = '';
      updates.completedBy = '';
      updates.forceCompletedAt = '';
      notificationStatus = 'rescheduled';
    } else if (status === 'confirmed') {
      updates.customerDecision = 'accepted';
      updates.customerDecisionAt = nowIso;
      updates.customerActionRequired = false;
      updates.customerActionDeadline = '';
      updates.customerTokenHash = '';
      updates.completionRequestedAt = '';
      updates.completionConfirmedAt = '';
      updates.completedBy = '';
      updates.forceCompletedAt = '';
      notificationStatus = 'confirmed';
    } else if (status === 'cancelled') {
      updates.customerDecision = 'cancelled';
      updates.customerDecisionAt = nowIso;
      updates.customerActionRequired = false;
      updates.customerActionDeadline = '';
      updates.customerTokenHash = '';
      updates.completionRequestedAt = '';
      updates.completionConfirmedAt = '';
      updates.completedBy = '';
      updates.forceCompletedAt = '';
      notificationStatus = 'cancelled';
    } else if (status === 'completed') {
      if (existing.type === 'reservation') {
        updates.customerActionRequired = false;
        updates.customerTokenHash = '';
        updates.customerActionDeadline = '';
        updates.completionConfirmedAt = nowIso;
        updates.completedBy = 'admin';
        updates.forceCompletedAt = '';
      }
      notificationStatus = 'completed';
    }

    if (hasReschedule) {
      updates.rescheduledAt = nowIso;
    }

    await bookingRef.set(updates, { merge: true });

    let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: 'No status email sent' };
    const toEmail = String(existing.email || '').trim();

    if (notificationStatus && toEmail.includes('@')) {
      const nextDate = date.length > 0 ? date : String(existing.date || '');
      const nextTime = time.length > 0 ? time : String(existing.time || '');

      const html = buildBookingStatusEmailHtml({
        customerName: String(existing.customerName || 'Customer'),
        serviceName: String(existing.serviceName || ''),
        barberName: String(existing.barberName || ''),
        date: nextDate,
        time: nextTime,
        price: Number(existing.price || 0),
        status: notificationStatus,
        previousSchedule: hasReschedule
          ? {
              date: String(existing.date || ''),
              time: String(existing.time || ''),
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
          reason: error instanceof Error ? error.message : 'Failed to send booking status email',
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

    res.status(200).json({ id, ...updates, emailSent: emailResult.sent, emailReason: emailResult.reason || '' });
    return;
  }

  // DELETE /api/admin/bookings/:id
  if (req.method === 'DELETE' && id) {
    const { adminDb } = getFirebaseAdminServices();
    await adminDb.collection('bookings').doc(id).delete();
    res.status(204).send('');
    return;
  }

  res.status(405).json({ message: 'Method not allowed' });
}

// ─── Main catch-all handler ───
export default async function handler(req: any, res: any) {
  const auth = await requireAdmin(req);
  if (auth.ok === false) {
    res.status(auth.status).json({ message: auth.message });
    return;
  }

  const segments = getPathSegments(req);
  const resource = (segments[0] || '').toLowerCase();

  try {
    switch (resource) {
      case 'barbers':
        await handleBarbers(req, res, segments);
        return;
      case 'bookings':
        await handleBookings(req, res, segments);
        return;
      case 'gallery':
        await handleGallery(req, res, segments);
        return;
      case 'services':
        await handleServices(req, res, segments);
        return;
      case 'settings':
        await handleSettings(req, res);
        return;
      case 'queue':
        await handleQueue(req, res, segments);
        return;
      default:
        res.status(404).json({ message: 'Admin route not found' });
    }
  } catch (error) {
    console.error(`admin ${resource} operation failed`, error);
    const message = error instanceof Error ? error.message : 'Admin operation failed';
    res.status(500).json({ message });
  }
}
