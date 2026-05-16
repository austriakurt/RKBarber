import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export type CustomerDecision =
  | 'awaiting'
  | 'accepted'
  | 'cancelled'
  | 'reschedule_requested'
  | 'expired';

export type BookingEmailStatus =
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'rescheduled'
  | 'completed';

export type BookingRecord = {
  id: string;
  barberId: string;
  barberName: string;
  customerName: string;
  phone: string;
  email?: string;
  date: string;
  time?: string;
  type: 'reservation' | 'walkin';
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  serviceName?: string;
  price?: number;
  customerDecision?: CustomerDecision;
  customerActionRequired?: boolean;
  customerTokenHash?: string;
  customerActionDeadline?: string;
  completionRequestedAt?: string;
  completionConfirmedAt?: string;
  completedBy?: 'client' | 'admin';
  forceCompletedAt?: string;
};

const DEFAULT_FORCE_COMPLETE_AFTER_HOURS = 6;

export function getBaseUrl(req: any): string {
  const isProd = process.env.NODE_ENV === 'production';
  const devBase = (process.env.DEV_PUBLIC_BASE_URL || '').trim();
  if (!isProd && devBase) return devBase.replace(/\/$/, '');

  const envBase = (process.env.PUBLIC_BASE_URL || '').trim();
  if (isProd && envBase) return envBase.replace(/\/$/, '');

  const origin = String(req.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/$/, '');

  const proto = String(req.headers?.['x-forwarded-proto'] || 'http');
  const host = String(
    req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost:5000'
  );
  return `${proto}://${host}`;
}

export function parseBookingDateTime(date: string, time?: string): Date | null {
  const safeDate = String(date || '').trim();
  if (!safeDate) return null;

  if (!time) {
    const d = new Date(`${safeDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = String(time)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) {
    const d = new Date(`${safeDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const period = m[3].toUpperCase();

  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const d = new Date(`${safeDate}T${hh}:${mm}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getActionDeadlineIso(
  date: string,
  time?: string
): string | null {
  const appt = parseBookingDateTime(date, time);
  if (!appt) return null;
  const deadline = new Date(appt.getTime() - 60 * 60 * 1000);
  return deadline.toISOString();
}

export function isInsideActionWindow(
  date: string,
  time?: string,
  now = new Date()
): boolean {
  const appt = parseBookingDateTime(date, time);
  if (!appt) return false;
  const deadline = new Date(appt.getTime() - 60 * 60 * 1000);
  return now.getTime() < deadline.getTime();
}

export function createActionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashActionToken(token: string): string {
  const secret =
    process.env.BOOKING_TOKEN_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_PROJECT_ID ||
    'rk-booking-secret';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function getBookingStatusEmailSubject(
  status: BookingEmailStatus
): string {
  if (status === 'approved') return 'RK Barbershop - Booking Approved';
  if (status === 'cancelled') return 'RK Barbershop - Booking Cancelled';
  if (status === 'rescheduled') return 'RK Barbershop - Booking Rescheduled';
  if (status === 'completed') return 'RK Barbershop - Service Completed';
  return 'RK Barbershop - Booking Request Received';
}

export function getBookingConfirmationRequestEmailSubject(): string {
  return 'RK Barbershop - Confirm Your Booking';
}

export function getBookingCompletionRequestEmailSubject(): string {
  return 'RK Barbershop - Confirm Service Completion';
}

export function getForceCompleteAfterHours(): number {
  const raw = Number(
    process.env.BOOKING_FORCE_COMPLETE_AFTER_HOURS ||
      DEFAULT_FORCE_COMPLETE_AFTER_HOURS
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_FORCE_COMPLETE_AFTER_HOURS;
  }
  return Math.floor(raw);
}

export function getForceCompleteEligibleAtIso(now = new Date()): string {
  const hours = getForceCompleteAfterHours();
  const eligibleAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return eligibleAt.toISOString();
}

export function getReservationReminderEmailSubject(): string {
  return 'RK Barbershop - Reminder: Your reservation is tomorrow';
}

export function buildReservationReminderEmailHtml(params: {
  customerName: string;
  serviceName: string;
  barberName: string;
  date: string;
  time?: string;
  price: number;
}): string {
  const { customerName, serviceName, barberName, date, time, price } = params;

  const rows = [
    ['Service(s)', serviceName || '-'],
    ['Barber', barberName || '-'],
    ['Schedule', `${date}${time ? ` at ${time}` : ''}`],
    ['Total', `PHP ${price}`],
    ['Status', 'Pending Reservation'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${escapeHtml(String(k))}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#F1F5F9;padding:26px 14px">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08)">
      <div style="padding:18px 22px;background:linear-gradient(120deg,#0F172A,#1E293B)">
        <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;font-weight:700">RK Barbershop</p>
        <h2 style="margin:8px 0 0;font-size:22px;line-height:1.2;color:#F8FAFC">Reservation Reminder</h2>
      </div>

      <div style="padding:22px">
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${escapeHtml(customerName)},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:#FFFBEB;color:#92400E;font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          Appointment Tomorrow
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">
          Friendly reminder: you have a pending reservation scheduled for tomorrow. Please make sure you are available and arrive on time.
        </p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        <div style="margin-top:16px;padding:12px;border-radius:10px;background:#F8FAFC;border-left:4px solid #D97706">
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.6">
            If you need to reschedule or cancel, please contact RK Barbershop as early as possible.
          </p>
        </div>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated reminder email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

export function buildBookingStatusEmailHtml(params: {
  customerName: string;
  serviceName: string;
  barberName: string;
  date: string;
  time?: string;
  price: number;
  status: BookingEmailStatus;
  rescheduleReason?: string;
  previousSchedule?: { date: string; time?: string };
}): string {
  const {
    customerName,
    serviceName,
    barberName,
    date,
    time,
    price,
    status,
    rescheduleReason,
    previousSchedule,
  } = params;

  const statusMeta: Record<
    BookingEmailStatus,
    {
      label: string;
      intro: string;
      accent: string;
      softBg: string;
      softText: string;
    }
  > = {
    pending: {
      label: 'Pending Admin Review',
      intro:
        'Your reservation has been received. Our team will review your booking and send another update once it is approved, cancelled, or rescheduled.',
      accent: '#D97706',
      softBg: '#FFFBEB',
      softText: '#92400E',
    },
    approved: {
      label: 'Approved',
      intro: 'Good news. Your booking has been approved by the shop admin.',
      accent: '#059669',
      softBg: '#ECFDF5',
      softText: '#065F46',
    },
    cancelled: {
      label: 'Cancelled',
      intro:
        'Your booking was cancelled by the shop admin. If you want a new slot, please submit another reservation.',
      accent: '#DC2626',
      softBg: '#FEF2F2',
      softText: '#991B1B',
    },
    rescheduled: {
      label: 'Rescheduled',
      intro:
        'Your booking schedule has been updated by the shop admin. Please review the new appointment details below.',
      accent: '#2563EB',
      softBg: '#EFF6FF',
      softText: '#1E3A8A',
    },
    completed: {
      label: 'Completed',
      intro:
        'Your service has been marked as completed. Thank you for choosing RK Barbershop. We look forward to seeing you again.',
      accent: '#0EA5E9',
      softBg: '#ECFEFF',
      softText: '#155E75',
    },
  };

  const meta = statusMeta[status];
  const rows = [
    ['Service(s)', serviceName || '-'],
    ['Barber', barberName || '-'],
    ['Schedule', `${date}${time ? ` at ${time}` : ''}`],
    ['Total', `PHP ${price}`],
    ['Status', meta.label],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${escapeHtml(String(k))}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');

  const previousScheduleHtml = previousSchedule
    ? `<div style="margin-top:14px;padding:12px;border-radius:10px;background:#F8FAFC;border:1px dashed #CBD5E1">
         <p style="margin:0 0 4px;font-size:12px;letter-spacing:.02em;color:#475569;font-weight:700">Previous Schedule</p>
         <p style="margin:0;font-size:13px;color:#0F172A;font-weight:600">${escapeHtml(previousSchedule.date)}${previousSchedule.time ? ` at ${escapeHtml(previousSchedule.time)}` : ''}</p>
       </div>`
    : '';

  const rescheduleReasonHtml =
    status === 'rescheduled'
      ? `<div style="margin-top:14px;padding:12px;border-radius:10px;background:#FFFBEB;border:1px solid #FDE68A">
         <p style="margin:0 0 4px;font-size:12px;letter-spacing:.02em;color:#92400E;font-weight:700">Reason for Reschedule</p>
         <p style="margin:0;font-size:13px;color:#78350F;font-weight:600">${escapeHtml(rescheduleReason || 'No reason provided.')}</p>
       </div>`
      : '';

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#F1F5F9;padding:26px 14px">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08)">
      <div style="padding:18px 22px;background:linear-gradient(120deg,#0F172A,#1E293B)">
        <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;font-weight:700">RK Barbershop</p>
        <h2 style="margin:8px 0 0;font-size:22px;line-height:1.2;color:#F8FAFC">Booking Update</h2>
      </div>

      <div style="padding:22px">
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${escapeHtml(customerName)},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:${meta.softBg};color:${meta.softText};font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          ${escapeHtml(meta.label)}
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">${escapeHtml(meta.intro)}</p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        ${previousScheduleHtml}
  ${rescheduleReasonHtml}

        <div style="margin-top:16px;padding:12px;border-radius:10px;background:#F8FAFC;border-left:4px solid ${meta.accent}">
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.6">
            For any questions or changes, please contact the RK Barbershop team directly.
          </p>
        </div>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated booking update email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

export function buildBookingConfirmationRequestEmailHtml(params: {
  baseUrl: string;
  token: string;
  bookingId: string;
  customerName: string;
  serviceName: string;
  barberName: string;
  date: string;
  time?: string;
  price: number;
}): string {
  const {
    baseUrl,
    token,
    bookingId,
    customerName,
    serviceName,
    barberName,
    date,
    time,
    price,
  } = params;
  const safeBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  const baseActionUrl = `${safeBaseUrl}/api/bookings/action`;
  const sharedParams = `token=${encodeURIComponent(token)}&bookingId=${encodeURIComponent(bookingId)}`;
  const confirmUrl = `${baseActionUrl}?action=confirm&${sharedParams}`;
  const declineUrl = `${baseActionUrl}?action=decline&${sharedParams}`;

  const rows = [
    ['Service(s)', serviceName || '-'],
    ['Barber', barberName || '-'],
    ['Schedule', `${date}${time ? ` at ${time}` : ''}`],
    ['Total', `PHP ${price}`],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${escapeHtml(String(k))}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#F1F5F9;padding:26px 14px">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08)">
      <div style="padding:18px 22px;background:linear-gradient(120deg,#0F172A,#1E293B)">
        <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;font-weight:700">RK Barbershop</p>
        <h2 style="margin:8px 0 0;font-size:22px;line-height:1.2;color:#F8FAFC">Booking Confirmation Needed</h2>
      </div>

      <div style="padding:22px">
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${escapeHtml(customerName)},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:#EFF6FF;color:#1E3A8A;font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          Action Required
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">
          Priority step: send your GCash payment first and ensure proof is uploaded. After payment, please confirm or decline this schedule so our team can proceed.
        </p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#059669;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Confirm</a>
          <a href="${escapeHtml(declineUrl)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#DC2626;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Decline</a>
        </div>

        <p style="margin:14px 0 0;color:#64748B;font-size:12px;line-height:1.6">
          If the buttons above do not work, copy and open this link to confirm:<br />
          <a href="${escapeHtml(confirmUrl)}" style="color:#2563EB;word-break:break-all">${escapeHtml(confirmUrl)}</a>
        </p>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated booking update email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

export function buildBookingCompletionRequestEmailHtml(params: {
  baseUrl: string;
  token: string;
  bookingId: string;
  customerName: string;
  serviceName: string;
  barberName: string;
  date: string;
  time?: string;
  price: number;
}): string {
  const {
    baseUrl,
    token,
    bookingId,
    customerName,
    serviceName,
    barberName,
    date,
    time,
    price,
  } = params;
  const safeBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  const baseActionUrl = `${safeBaseUrl}/api/bookings/action`;
  const sharedParams = `token=${encodeURIComponent(token)}&bookingId=${encodeURIComponent(bookingId)}`;
  const completeUrl = `${baseActionUrl}?action=complete&${sharedParams}`;

  const rows = [
    ['Service(s)', serviceName || '-'],
    ['Barber', barberName || '-'],
    ['Schedule', `${date}${time ? ` at ${time}` : ''}`],
    ['Total', `PHP ${price}`],
    ['Booking Status', 'Admin Confirmed'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${escapeHtml(String(k))}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#F1F5F9;padding:26px 14px">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08)">
      <div style="padding:18px 22px;background:linear-gradient(120deg,#0F172A,#1E293B)">
        <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;font-weight:700">RK Barbershop</p>
        <h2 style="margin:8px 0 0;font-size:22px;line-height:1.2;color:#F8FAFC">Booking Confirmed by Admin</h2>
      </div>

      <div style="padding:22px">
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${escapeHtml(customerName)},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:#ECFDF5;color:#065F46;font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          Completion Confirmation Needed
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">
          Your booking is now confirmed by our admin. After your service is done, please click the button below to confirm completion.
        </p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${escapeHtml(completeUrl)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#0EA5E9;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Mark Service Complete</a>
        </div>

        <p style="margin:14px 0 0;color:#64748B;font-size:12px;line-height:1.6">
          If the button does not work, copy and open this link:<br />
          <a href="${escapeHtml(completeUrl)}" style="color:#2563EB;word-break:break-all">${escapeHtml(completeUrl)}</a>
        </p>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated booking update email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

export async function sendBookingActionEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const from = (process.env.BOOKING_FROM_EMAIL || user || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !user || !pass || !from) {
    return {
      sent: false,
      reason: 'SMTP environment variables are not configured',
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  return { sent: true };
}

export function decisionToStatus(
  decision: CustomerDecision
): BookingRecord['status'] {
  if (decision === 'accepted') return 'confirmed';
  if (decision === 'cancelled' || decision === 'expired') return 'cancelled';
  return 'pending';
}

export function actionResultHtml(
  title: string,
  message: string,
  ok = true
): string {
  return actionResultWithBackHtml({ title, message, ok });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function bookingActionPageHtml(params: {
  title: string;
  subtitle?: string;
  bodyHtml: string;
  baseUrl: string;
}): string {
  const subtitle = params.subtitle
    ? `<p class="subtitle">${escapeHtml(params.subtitle)}</p>`
    : '';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    :root {
      --bg: #08090c;
      --card: rgba(18, 20, 26, 0.9);
      --text: #e6e8ef;
      --muted: #9aa3b2;
      --gold: #d8a615;
      --line: rgba(216, 166, 21, 0.25);
      --ok: #2fb86e;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(1200px 500px at 10% -20%, rgba(216,166,21,.20), transparent 60%),
        radial-gradient(900px 500px at 100% 0%, rgba(55,65,81,.24), transparent 60%),
        var(--bg);
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 760px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: var(--card);
      box-shadow: 0 24px 80px rgba(0,0,0,.45);
      overflow: hidden;
      backdrop-filter: blur(8px);
    }
    .topline {
      height: 4px;
      width: 100%;
      background: linear-gradient(90deg, var(--gold), rgba(216,166,21,.25));
    }
    .inner { padding: 24px; }
    .brand { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); font-weight: 700; }
    h1 { margin: 8px 0 8px; font-size: 30px; line-height: 1.15; }
    .subtitle { margin: 0 0 18px; color: var(--muted); font-size: 14px; }
    .actions { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 10px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,.18);
      color: var(--text);
      text-decoration: none;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      background: rgba(255,255,255,.05);
    }
    .btn-primary { background: var(--gold); border-color: var(--gold); color: #131313; }
    .panel {
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 14px;
      background: rgba(255,255,255,.03);
      padding: 16px;
    }
    .field { margin-bottom: 12px; }
    .field label { display: block; color: var(--muted); margin-bottom: 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .input {
      width: 100%;
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 10px;
      background: rgba(8,9,12,.75);
      color: var(--text);
      padding: 10px 12px;
      font-size: 14px;
    }
    .muted { color: var(--muted); font-size: 13px; }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
  </style>
</head>
<body>
  <div class="card">
    <div class="topline"></div>
    <div class="inner">
      <div class="brand">RK Barbershop</div>
      <h1>${escapeHtml(params.title)}</h1>
      ${subtitle}
      ${params.bodyHtml}
      <div class="actions">
        <a class="btn" href="${params.baseUrl}">Back to Homepage</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function actionResultWithBackHtml(params: {
  title: string;
  message: string;
  ok?: boolean;
  baseUrl?: string;
}): string {
  const ok = params.ok !== false;
  const bodyHtml = `<div class="panel"><p class="${ok ? 'ok' : 'danger'}" style="margin:0;font-weight:700">${escapeHtml(params.message)}</p></div>`;
  return bookingActionPageHtml({
    title: params.title,
    subtitle: 'Booking action result',
    bodyHtml,
    baseUrl: params.baseUrl || '/',
  });
}

export function rescheduleFormHtml(params: {
  baseUrl: string;
  token: string;
  bookingId: string;
  currentDate: string;
  currentTime: string;
  minDate: string;
  maxDate: string;
  defaultTime24: string;
  availabilityText: string;
}): string {
  const bodyHtml = `
    <div class="panel" style="margin-bottom:12px">
      <p style="margin:0 0 8px;font-weight:700">Current schedule</p>
      <p class="muted" style="margin:0">${escapeHtml(params.currentDate)} ${escapeHtml(params.currentTime || '')}</p>
      <p class="muted" style="margin:10px 0 0">${escapeHtml(params.availabilityText)}</p>
    </div>

    <form method="POST" action="${params.baseUrl}/api/bookings/action">
      <input type="hidden" name="token" value="${escapeHtml(params.token)}" />
      <input type="hidden" name="action" value="reschedule" />
      <input type="hidden" name="bookingId" value="${escapeHtml(params.bookingId)}" />

      <div class="field">
        <label for="date">New Date</label>
        <input class="input" id="date" name="date" type="date" required min="${escapeHtml(params.minDate)}" max="${escapeHtml(params.maxDate)}" value="${escapeHtml(params.currentDate)}" />
      </div>
      <div class="field">
        <label for="time">New Time</label>
        <input class="input" id="time" name="time" type="time" required value="${escapeHtml(params.defaultTime24)}" />
      </div>

      <div class="actions" style="margin-top:6px">
        <button class="btn btn-primary" type="submit">Update Booking</button>
        <a class="btn" href="${params.baseUrl}">Cancel</a>
      </div>
    </form>
  `;

  return bookingActionPageHtml({
    title: 'Reschedule Booking',
    subtitle: 'Choose a new schedule based on barber availability',
    bodyHtml,
    baseUrl: params.baseUrl,
  });
}
