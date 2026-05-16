import type { Express, Response, Request, NextFunction } from 'express';
import type { Server } from 'http';
import { storage } from './storage';
import { insertUserSchema, type User } from '@shared/schema';
import { adminAuth, adminDb } from './firebaseAdmin';
import { z } from 'zod';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

const ALLOWED_UPLOAD_HOSTS = new Set(['res.cloudinary.com']);

type ApiError = {
  message: string;
};

type AdminClaims = {
  admin?: boolean;
  role?: string;
  email?: string;
};

type AdminRequest = Request & {
  adminUid?: string;
};

type CustomerDecision =
  | 'awaiting'
  | 'accepted'
  | 'cancelled'
  | 'reschedule_requested'
  | 'expired';
type BookingEmailStatus =
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'rescheduled'
  | 'completed';
const DEFAULT_FORCE_COMPLETE_AFTER_HOURS = 6;

const MAX_UPLOAD_SIZE_BYTES = 3 * 1024 * 1024;
const uploadImageSchema = z.object({
  dataUrl: z.string().min(1),
  folder: z.enum(['gcash', 'proofs', 'barbers', 'gallery']).optional(),
  filename: z.string().optional(),
});

function sanitizeUploadFilename(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

function sanitizeDownloadFilename(fileName: string): string {
  return (
    fileName
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120) || 'download-file'
  );
}

function parseAndValidateRemoteUrl(urlValue: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error('Invalid download URL');
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('Only HTTP(S) download URLs are allowed');
  }

  if (!ALLOWED_UPLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Download host is not allowed');
  }

  return parsed;
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function parseImageDataUrl(dataUrl: string): {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
} {
  const m = String(dataUrl).match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (!m) {
    throw new Error('Invalid image format. Use PNG, JPG, or WebP');
  }

  const mimeType = m[1].toLowerCase() as
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp';
  const base64 = m[2].replace(/\s+/g, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Uploaded image is empty');
  }
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('Image must be 3MB or smaller');
  }

  return { mimeType };
}

type CloudinaryConfig = {
  apiKey: string;
  apiSecret: string;
  cloudName: string;
};

function getCloudinaryConfig(): CloudinaryConfig {
  const raw = String(process.env.CLOUDINARY_URL || '').trim();
  if (!raw) {
    throw new Error('CLOUDINARY_URL is not configured');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('CLOUDINARY_URL is invalid');
  }

  if (parsed.protocol !== 'cloudinary:') {
    throw new Error('CLOUDINARY_URL must use the cloudinary:// protocol');
  }

  const apiKey = decodeURIComponent(parsed.username || '').trim();
  const apiSecret = decodeURIComponent(parsed.password || '').trim();
  const cloudName = decodeURIComponent(parsed.hostname || '').trim();
  if (!apiKey || !apiSecret || !cloudName) {
    throw new Error(
      'CLOUDINARY_URL is missing api key, api secret, or cloud name'
    );
  }

  return { apiKey, apiSecret, cloudName };
}

async function uploadViaCloudinary(
  dataUrl: string,
  fileName: string,
  folder?: 'gcash' | 'proofs' | 'barbers' | 'gallery'
): Promise<string> {
  const { apiKey, apiSecret, cloudName } = getCloudinaryConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const safeFolder = folder || 'proofs';
  const publicId = sanitizeUploadFilename(fileName).replace(
    /\.[a-z0-9]+$/i,
    ''
  );
  const signatureBase = `folder=${safeFolder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto
    .createHash('sha1')
    .update(signatureBase)
    .digest('hex');

  const body = new URLSearchParams();
  body.set('file', dataUrl);
  body.set('folder', safeFolder);
  body.set('public_id', publicId);
  body.set('timestamp', timestamp);
  body.set('api_key', apiKey);
  body.set('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );

  const payload = (await response.json().catch(() => null)) as {
    secure_url?: string;
    url?: string;
    error?: { message?: string };
  } | null;
  const url = String(payload?.secure_url || payload?.url || '').trim();
  if (!response.ok || !/^https?:\/\//i.test(url)) {
    throw new Error(payload?.error?.message || 'cloudinary upload failed');
  }

  return url;
}

async function uploadToFreeHost(params: {
  dataUrl: string;
  folder?: 'gcash' | 'proofs' | 'barbers' | 'gallery';
  filename?: string;
}): Promise<string> {
  const { mimeType } = parseImageDataUrl(params.dataUrl);
  const ext = extensionFromMime(mimeType);
  const baseName = sanitizeUploadFilename(
    params.filename || `image-${Date.now()}.${ext}`
  );
  const fileName = `${params.folder || 'proofs'}-${Date.now()}-${baseName}`;

  return uploadViaCloudinary(params.dataUrl, fileName, params.folder);
}

function isValidPHPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
}

function getBaseUrl(req: Request): string {
  const isProd = process.env.NODE_ENV === 'production';
  const devBase = (process.env.DEV_PUBLIC_BASE_URL || '').trim();
  if (!isProd && devBase) return devBase.replace(/\/$/, '');

  const envBase = (process.env.PUBLIC_BASE_URL || '').trim();
  if (isProd && envBase) return envBase.replace(/\/$/, '');

  const origin = String(req.header('origin') || '').trim();
  if (origin) return origin.replace(/\/$/, '');

  const proto = String(req.header('x-forwarded-proto') || 'http');
  const host = String(
    req.header('x-forwarded-host') || req.header('host') || 'localhost:5000'
  );
  return `${proto}://${host}`;
}

function parseBookingDateTime(date: string, time?: string): Date | null {
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

function isInsideActionWindow(
  date: string,
  time?: string,
  now = new Date()
): boolean {
  const appt = parseBookingDateTime(date, time);
  if (!appt) return false;
  const deadline = new Date(appt.getTime() - 60 * 60 * 1000);
  return now.getTime() < deadline.getTime();
}

function getActionDeadlineIso(date: string, time?: string): string | null {
  const appt = parseBookingDateTime(date, time);
  if (!appt) return null;
  return new Date(appt.getTime() - 60 * 60 * 1000).toISOString();
}

function createActionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashActionToken(token: string): string {
  const secret =
    process.env.BOOKING_TOKEN_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_PROJECT_ID ||
    'rk-booking-secret';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function getForceCompleteAfterHours(): number {
  const raw = Number(
    process.env.BOOKING_FORCE_COMPLETE_AFTER_HOURS ||
      DEFAULT_FORCE_COMPLETE_AFTER_HOURS
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_FORCE_COMPLETE_AFTER_HOURS;
  }
  return Math.floor(raw);
}

function getForceCompleteEligibleAtIso(now = new Date()): string {
  const eligibleAt = new Date(
    now.getTime() + getForceCompleteAfterHours() * 60 * 60 * 1000
  );
  return eligibleAt.toISOString();
}

function decisionToStatus(
  decision: CustomerDecision
): 'pending' | 'confirmed' | 'cancelled' {
  if (decision === 'accepted') return 'confirmed';
  if (decision === 'cancelled' || decision === 'expired') return 'cancelled';
  return 'pending';
}

function actionResultHtml(title: string, message: string, ok = true): string {
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head>
<body style="margin:0;background:#0b0f17;color:#e2e8f0;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px;">
  <div style="max-width:560px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:14px;padding:22px;">
    <h1 style="margin:0 0 10px;font-size:22px;color:${color}">${title}</h1>
    <p style="margin:0;color:#cbd5e1;line-height:1.5">${message}</p>
  </div>
</body></html>`;
}

function getBookingStatusEmailSubject(status: BookingEmailStatus): string {
  if (status === 'approved') return 'RK Barbershop - Booking Approved';
  if (status === 'cancelled') return 'RK Barbershop - Booking Cancelled';
  if (status === 'rescheduled') return 'RK Barbershop - Booking Rescheduled';
  if (status === 'completed') return 'RK Barbershop - Service Completed';
  return 'RK Barbershop - Booking Request Received';
}

function getBookingConfirmationRequestEmailSubject(): string {
  return 'RK Barbershop - Confirm Your Booking';
}

function getBookingCompletionRequestEmailSubject(): string {
  return 'RK Barbershop - Confirm Service Completion';
}

function buildBookingStatusEmailHtml(params: {
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

  const meta = statusMeta[params.status];
  const rows = [
    ['Service(s)', params.serviceName || '-'],
    ['Barber', params.barberName || '-'],
    ['Schedule', `${params.date}${params.time ? ` at ${params.time}` : ''}`],
    ['Total', `PHP ${params.price}`],
    ['Status', meta.label],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${String(k)}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${String(v)}</td></tr>`
    )
    .join('');

  const previousScheduleHtml = params.previousSchedule
    ? `<div style="margin-top:14px;padding:12px;border-radius:10px;background:#F8FAFC;border:1px dashed #CBD5E1">
         <p style="margin:0 0 4px;font-size:12px;letter-spacing:.02em;color:#475569;font-weight:700">Previous Schedule</p>
         <p style="margin:0;font-size:13px;color:#0F172A;font-weight:600">${params.previousSchedule.date}${params.previousSchedule.time ? ` at ${params.previousSchedule.time}` : ''}</p>
       </div>`
    : '';

  const rescheduleReasonHtml =
    params.status === 'rescheduled'
      ? `<div style="margin-top:14px;padding:12px;border-radius:10px;background:#FFFBEB;border:1px solid #FDE68A">
         <p style="margin:0 0 4px;font-size:12px;letter-spacing:.02em;color:#92400E;font-weight:700">Reason for Reschedule</p>
         <p style="margin:0;font-size:13px;color:#78350F;font-weight:600">${params.rescheduleReason || 'No reason provided.'}</p>
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
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${params.customerName},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:${meta.softBg};color:${meta.softText};font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          ${meta.label}
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">${meta.intro}</p>

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

function buildBookingConfirmationRequestEmailHtml(params: {
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
  const safeBaseUrl = String(params.baseUrl || '').replace(/\/$/, '');
  const baseActionUrl = `${safeBaseUrl}/api/bookings/action`;
  const shared = `token=${encodeURIComponent(params.token)}&bookingId=${encodeURIComponent(params.bookingId)}`;
  const confirmUrl = `${baseActionUrl}?action=confirm&${shared}`;
  const declineUrl = `${baseActionUrl}?action=decline&${shared}`;
  const rows = [
    ['Service(s)', params.serviceName || '-'],
    ['Barber', params.barberName || '-'],
    ['Schedule', `${params.date}${params.time ? ` at ${params.time}` : ''}`],
    ['Total', `PHP ${params.price}`],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${String(k)}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${String(v)}</td></tr>`
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
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${params.customerName},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:#EFF6FF;color:#1E3A8A;font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          Action Required
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">Priority step: send your GCash payment first and ensure proof is uploaded. After payment, please confirm or decline this schedule so our team can proceed.</p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${confirmUrl}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#059669;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Confirm</a>
          <a href="${declineUrl}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#DC2626;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Decline</a>
        </div>

        <p style="margin:14px 0 0;color:#64748B;font-size:12px;line-height:1.6">This is an automated booking update email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

function buildBookingCompletionRequestEmailHtml(params: {
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
  const safeBaseUrl = String(params.baseUrl || '').replace(/\/$/, '');
  const baseActionUrl = `${safeBaseUrl}/api/bookings/action`;
  const shared = `token=${encodeURIComponent(params.token)}&bookingId=${encodeURIComponent(params.bookingId)}`;
  const completeUrl = `${baseActionUrl}?action=complete&${shared}`;
  const rows = [
    ['Service(s)', params.serviceName || '-'],
    ['Barber', params.barberName || '-'],
    ['Schedule', `${params.date}${params.time ? ` at ${params.time}` : ''}`],
    ['Total', `PHP ${params.price}`],
    ['Booking Status', 'Admin Confirmed'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${String(k)}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${String(v)}</td></tr>`
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
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${params.customerName},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:#ECFDF5;color:#065F46;font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          Completion Confirmation Needed
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">Your booking is now confirmed by our admin. After your service is done, please click the button below to confirm completion.</p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>

        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${completeUrl}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#0EA5E9;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none">Mark Service Complete</a>
        </div>

        <p style="margin:14px 0 0;color:#64748B;font-size:12px;line-height:1.6">If the button does not work, copy and open this link:<br /><a href="${completeUrl}" style="color:#2563EB;word-break:break-all">${completeUrl}</a></p>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated booking update email from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

function buildWalkinYoureNextEmailHtml(params: {
  customerName: string;
  barberName: string;
  position: number;
}): string {
  const isNext = params.position <= 1;
  const badgeText = isNext ? 'Get Ready!' : `Position #${params.position}`;
  const badgeBg = isNext ? '#FEF3C7' : '#EFF6FF';
  const badgeColor = isNext ? '#92400E' : '#1E3A8A';
  const messageText = isNext
    ? `You are <strong>next in line</strong> for <strong>${params.barberName}</strong>'s chair. Please make sure you're at the shop and ready to go!`
    : `You're almost up! You are <strong>#${params.position} in line</strong> for <strong>${params.barberName}</strong>. Please stay nearby and be ready when called.`;
  const positionLabel = isNext ? 'Next' : `#${params.position} in line`;
  const positionColor = isNext ? '#059669' : '#2563EB';

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#F1F5F9;padding:26px 14px">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08)">
      <div style="padding:18px 22px;background:linear-gradient(120deg,#0F172A,#1E293B)">
        <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;font-weight:700">RK Barbershop</p>
        <h2 style="margin:8px 0 0;font-size:22px;line-height:1.2;color:#F8FAFC">${isNext ? "You're Next in Line!" : 'Your Turn Is Coming Up!'}</h2>
      </div>

      <div style="padding:22px">
        <p style="margin:0 0 10px;color:#0F172A;font-size:15px">Hi ${params.customerName},</p>
        <div style="display:inline-block;padding:6px 11px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:12px;font-weight:700;border:1px solid rgba(15,23,42,.08)">
          ${badgeText}
        </div>
        <p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.6">${messageText}</p>

        <div style="margin-top:16px;border:1px solid #E2E8F0;border-radius:12px;padding:14px;background:#FFFFFF">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Barber</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${params.barberName}</td></tr>
            <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Queue Position</td><td style="padding:8px 0;text-align:right;font-weight:700;color:${positionColor};font-size:13px">${positionLabel}</td></tr>
          </table>
        </div>

        <div style="margin-top:16px;padding:12px;border-radius:10px;background:#FFFBEB;border-left:4px solid #D97706">
          <p style="margin:0;font-size:12px;color:#92400E;line-height:1.6">
            Please be present at the shop. If you're not available when called, your turn may be skipped.
          </p>
        </div>

        <p style="margin:16px 0 0;font-size:12px;color:#64748B">This is an automated queue notification from RK Barbershop.</p>
      </div>
    </div>
  </div>`;
}

async function sendBookingActionEmail(params: {
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

const bookingStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']),
});

const bookingPatchSchema = z
  .object({
    status: z
      .enum(['pending', 'confirmed', 'cancelled', 'completed'])
      .optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one booking field must be provided',
  });

const bookingsQuerySchema = z.object({
  date: z.string().optional(),
});

const queuePatchSchema = z
  .object({
    status: z.enum(['waiting', 'in-progress', 'done']).optional(),
    position: z.number().int().positive().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one queue field must be provided',
  });

const serviceCreateSchema = z.object({
  name: z.string().min(1),
  serviceType: z.enum(['solo', 'package']).optional(),
  includedServiceIds: z.array(z.string()).optional(),
  description: z.string(),
  price: z.number(),
  walkinPrice: z.number().optional(),
  reservationPrice: z.number().optional(),
  noPrice: z.boolean().optional(),
  duration: z.number().int().positive(),
  active: z.boolean(),
  order: z.number(),
  createdAt: z.string(),
});

const servicePatchSchema = serviceCreateSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one service field must be provided',
  });

const barberCreateSchema = z.object({
  name: z.string().min(1),
  specialty: z.string(),
  services: z.array(z.string()).optional(),
  reservePrice: z.number(),
  walkinPrice: z.number(),
  active: z.boolean(),
  image: z.string(),
  order: z.number(),
  availableDays: z.array(z.string()),
  availableFrom: z.string(),
  availableTo: z.string(),
  daysOff: z.array(z.string()).optional(),
  createdAt: z.string(),
});

const barberPatchSchema = barberCreateSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one barber field must be provided',
  });

const settingsPatchSchema = z
  .object({
    shopName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    country: z.string().optional(),
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
    operatingDays: z.string().optional(),
    email: z.string().optional(),
    facebookUrl: z.string().optional(),
    tiktokUrl: z.string().optional(),
    googleMapsUrl: z.string().optional(),
    tagline: z.string().optional(),
    aboutText: z.string().optional(),
    gcashNumber: z.string().optional(),
    gcashQrCodeUrl: z.string().optional(),
    reservationPolicyText: z.string().optional(),
    combo1ServiceAId: z.string().optional(),
    combo1ServiceBId: z.string().optional(),
    combo1WalkinPrice: z.number().optional(),
    combo1ReservationPrice: z.number().optional(),
    combo2ServiceAId: z.string().optional(),
    combo2ServiceBId: z.string().optional(),
    combo2WalkinPrice: z.number().optional(),
    combo2ReservationPrice: z.number().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one settings field must be provided',
  });

function parseEmailAllowlist(): Set<string> {
  const allowlist = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const fallback = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return new Set([...allowlist, ...(fallback ? [fallback] : [])]);
}

function hasAdminRights(claims: AdminClaims): boolean {
  if (claims.admin === true || claims.role === 'admin') {
    return true;
  }

  const allowlist = parseEmailAllowlist();
  if (allowlist.size === 0) {
    return false;
  }

  const email = (claims.email || '').trim().toLowerCase();
  return email.length > 0 && allowlist.has(email);
}

async function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res
        .status(401)
        .json({
          message: 'Missing or invalid authorization header',
        } satisfies ApiError);
    }

    const decoded = await adminAuth.verifyIdToken(token, true);
    if (!hasAdminRights(decoded as AdminClaims)) {
      return res
        .status(403)
        .json({ message: 'Admin role required' } satisfies ApiError);
    }

    req.adminUid = decoded.uid;
    return next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' } satisfies ApiError);
  }
}

function sendBadRequest(res: Response, message: string) {
  return res.status(400).json({ message } satisfies ApiError);
}

function sendNotFound(res: Response, message: string) {
  return res.status(404).json({ message } satisfies ApiError);
}

function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get('/api/health', (_req, res) => {
    return res.status(200).json({
      status: 'ok',
      service: 'rkbarbershop-api',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/users/:id', async (req, res, next) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      return res.status(200).json(sanitizeUser(user));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/users', async (req, res, next) => {
    try {
      const username = String(req.query.username ?? '').trim();
      if (!username) {
        return sendBadRequest(res, "Query parameter 'username' is required");
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      return res.status(200).json(sanitizeUser(user));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/users', async (req, res, next) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Invalid request payload',
          issues: parsed.error.issues,
        });
      }

      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ message: 'Username already exists' });
      }

      const user = await storage.createUser(parsed.data);
      return res.status(201).json(sanitizeUser(user));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/uploads/image', async (req, res, next) => {
    try {
      const parsed = uploadImageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid upload payload',
            issues: parsed.error.issues,
          });
      }

      const url = await uploadToFreeHost(parsed.data);
      return res.status(200).json({ url });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Image upload failed';
      return res.status(502).json({ message });
    }
  });

  app.get('/api/uploads/download', async (req, res) => {
    try {
      const rawUrl = String(req.query.url || '').trim();
      const fileName = sanitizeDownloadFilename(
        String(req.query.filename || 'download-file')
      );
      if (!rawUrl) {
        return res.status(400).send("Missing 'url' query parameter");
      }

      const parsedUrl = parseAndValidateRemoteUrl(rawUrl);
      const upstream = await fetch(parsedUrl.toString());
      if (!upstream.ok) {
        return res.status(502).send('Failed to fetch remote file');
      }

      const contentType =
        upstream.headers.get('content-type') || 'application/octet-stream';
      const data = Buffer.from(await upstream.arrayBuffer());

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=\"${fileName}\"`
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Download failed';
      return res.status(400).send(message);
    }
  });

  app.post('/api/bookings', async (req, res, next) => {
    try {
      const payload = req.body || {};
      const type = String(payload.type || '').trim() as
        | 'reservation'
        | 'walkin';
      const barberId = String(payload.barberId || '').trim();
      const customerName = String(payload.customerName || '').trim();
      const phone = String(payload.phone || '').trim();
      const email = String(payload.email || '').trim();
      const date = String(payload.date || '').trim();
      const time = String(payload.time || '').trim();

      if (type !== 'reservation' && type !== 'walkin') {
        return sendBadRequest(res, 'Invalid booking type');
      }
      if (!barberId || !customerName || !phone || !date) {
        return sendBadRequest(res, 'Missing required booking fields');
      }
      if (!isValidPHPhone(phone)) {
        return sendBadRequest(res, 'Invalid phone number');
      }
      if (type === 'reservation' && (!email || !email.includes('@'))) {
        return sendBadRequest(res, 'Reservation requires a valid email');
      }

      const barberDoc = await adminDb.collection('barbers').doc(barberId).get();
      if (!barberDoc.exists) {
        return sendBadRequest(res, 'Selected barber not found');
      }

      const barber = barberDoc.data() as Record<string, unknown>;
      const barberName = String(barber.name || payload.barberName || '').trim();
      const price =
        type === 'reservation'
          ? Number(barber.reservePrice || 0)
          : Number(barber.walkinPrice || 0);
      const paymentProofUrl = String(payload.paymentProofUrl || '').trim();

      if (type === 'reservation' && price > 0 && !paymentProofUrl) {
        return sendBadRequest(res, 'Reservation requires payment proof upload');
      }

      const bookingData = {
        barberId,
        barberName,
        serviceId: String(payload.serviceId || ''),
        serviceName: String(payload.serviceName || ''),
        serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
        serviceNames: Array.isArray(payload.serviceNames)
          ? payload.serviceNames
          : [],
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
        customerDecisionAt:
          type === 'reservation' ? '' : new Date().toISOString(),
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

      return res.status(201).json({
        id: bookingRef.id,
        status: bookingData.status,
        price,
        emailSent: emailResult.sent,
        emailReason: emailResult.reason || '',
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/bookings/action', async (req, res, next) => {
    try {
      const rawAction = String(req.query.action || req.query.decision || '')
        .trim()
        .toLowerCase();
      const action =
        rawAction === 'approve' || rawAction === 'accept'
          ? 'confirm'
          : rawAction === 'cancel'
            ? 'decline'
            : rawAction;
      const token = String(req.query.token || req.query.t || '').trim();
      const bookingId = String(
        req.query.bookingId || req.query.id || ''
      ).trim();

      if (
        !bookingId ||
        !token ||
        (action !== 'confirm' && action !== 'decline' && action !== 'complete')
      ) {
        return res
          .status(400)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            actionResultHtml(
              'Invalid Action Link',
              'This booking action link is incomplete or invalid.',
              false
            )
          );
      }

      const bookingRef = adminDb.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        return res
          .status(404)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            actionResultHtml(
              'Booking Not Found',
              'This booking record no longer exists.',
              false
            )
          );
      }

      const booking = bookingSnap.data() as Record<string, unknown>;
      const storedHash = String(booking.customerTokenHash || '');
      if (!storedHash || storedHash !== hashActionToken(token)) {
        return res
          .status(403)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            actionResultHtml(
              'Link Not Valid',
              'This booking action link has expired or is no longer valid.',
              false
            )
          );
      }

      if (
        booking.customerActionRequired === false ||
        String(booking.status || '') === 'completed'
      ) {
        const alreadyMessage =
          action === 'complete'
            ? 'This booking is already marked as completed.'
            : 'This booking action was already completed.';
        return res
          .status(200)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(actionResultHtml('Already Processed', alreadyMessage, true));
      }

      const isCompletionAction = action === 'complete';
      const isLegacyDecision = action === 'confirm' || action === 'decline';

      if (isLegacyDecision && String(booking.status || '') !== 'pending') {
        return res
          .status(409)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            actionResultHtml(
              'Link Not Applicable',
              'This link is for a previous booking flow and can no longer be used.',
              false
            )
          );
      }

      if (isCompletionAction && String(booking.status || '') !== 'confirmed') {
        return res
          .status(409)
          .setHeader('Content-Type', 'text/html; charset=utf-8')
          .send(
            actionResultHtml(
              'Completion Not Available',
              'This booking is not in a confirmable state for completion.',
              false
            )
          );
      }

      const nowIso = new Date().toISOString();
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

      let emailResult: { sent: boolean; reason?: string } = {
        sent: false,
        reason: 'No status email sent',
      };
      const toEmail = String(booking.email || '').trim();
      if (toEmail.includes('@')) {
        const emailStatus: BookingEmailStatus = isCompletionAction
          ? 'completed'
          : action === 'confirm'
            ? 'approved'
            : 'cancelled';
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
            reason:
              error instanceof Error
                ? error.message
                : 'Failed to send booking action result email',
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

      return res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          actionResultHtml(
            isCompletionAction
              ? 'Service Completion Confirmed'
              : action === 'confirm'
                ? 'Booking Confirmed'
                : 'Booking Declined',
            isCompletionAction
              ? 'Thank you. Your booking has been marked as completed.'
              : action === 'confirm'
                ? 'Thank you. Your booking is now confirmed and ready for service.'
                : 'Your booking has been declined. If you still need a slot, please make a new reservation.',
            isCompletionAction ? true : action === 'confirm'
          )
        );
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/cron/expire-bookings', async (req, res, next) => {
    try {
      const expected = (process.env.CRON_SECRET || '').trim();
      const isVercelCron = String(req.header('user-agent') || '')
        .toLowerCase()
        .includes('vercel-cron');
      if (expected && !isVercelCron) {
        const providedHeader = String(req.header('x-cron-secret') || '').trim();
        const providedQuery = String(req.query.secret || '').trim();
        if (providedHeader !== expected && providedQuery !== expected) {
          return res.status(401).json({ message: 'Unauthorized cron call' });
        }
      }
      return res.status(200).json({
        checked: 0,
        cancelled: 0,
        disabled: true,
        reason:
          'Client-action expiration is disabled. Booking decisions are now admin-managed.',
      });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const parsed = bookingPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid booking payload',
            issues: parsed.error.issues,
          });
      }

      const bookingRef = adminDb.collection('bookings').doc(id);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      const existing = bookingSnap.data() as Record<string, any>;
      const reason =
        typeof parsed.data.reason === 'string' ? parsed.data.reason.trim() : '';
      const hasReschedule = Boolean(parsed.data.date || parsed.data.time);
      if (hasReschedule && !reason) {
        return res
          .status(400)
          .json({ message: 'Reschedule reason is required' });
      }
      if (reason.length > 255) {
        return res
          .status(400)
          .json({
            message: 'Reschedule reason must be 255 characters or less',
          });
      }

      const updates: Record<string, unknown> = { ...parsed.data };
      delete updates.reason;

      if (
        parsed.data.status === 'confirmed' &&
        existing.type === 'reservation' &&
        String(existing.status || '') === 'completed'
      ) {
        return res
          .status(409)
          .json({
            message: 'Completed bookings cannot be moved back to confirmed.',
          });
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
        updates.rescheduleReason = reason;
        notificationStatus = 'rescheduled';
      } else if (parsed.data.status === 'confirmed') {
        updates.customerDecision = 'accepted';
        updates.customerDecisionAt = nowIso;
        updates.customerActionRequired = false;
        updates.customerActionDeadline = '';
        updates.customerTokenHash = '';
        updates.completionRequestedAt = '';
        updates.completionConfirmedAt = '';
        updates.completedBy = '';
        updates.forceCompletedAt = '';
        notificationStatus = 'approved';
      } else if (parsed.data.status === 'cancelled') {
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
      } else if (parsed.data.status === 'completed') {
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

      let emailResult: { sent: boolean; reason?: string } = {
        sent: false,
        reason: 'No status email sent',
      };
      const toEmail = String(existing.email || '').trim();
      if (notificationStatus && toEmail.includes('@')) {
        const nextDate = parsed.data.date || String(existing.date || '');
        const nextTime = parsed.data.time || String(existing.time || '');
        const html = buildBookingStatusEmailHtml({
          customerName: String(existing.customerName || 'Customer'),
          serviceName: String(existing.serviceName || ''),
          barberName: String(existing.barberName || ''),
          date: String(nextDate),
          time: String(nextTime),
          price: Number(existing.price || 0),
          status: notificationStatus,
          rescheduleReason: hasReschedule ? reason : undefined,
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
            reason:
              error instanceof Error
                ? error.message
                : 'Failed to send booking status email',
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

      return res
        .status(200)
        .json({
          id,
          ...updates,
          emailSent: emailResult.sent,
          emailReason: emailResult.reason || '',
        });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/bookings', requireAdmin, async (req, res, next) => {
    try {
      const parsedQuery = bookingsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid bookings query',
            issues: parsedQuery.error.issues,
          });
      }

      const snapshot = await adminDb
        .collection('bookings')
        .orderBy('createdAt', 'desc')
        .get();
      const bookings = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      })) as Array<{ id: string; date?: unknown } & Record<string, unknown>>;
      const dateFilter = (parsedQuery.data.date || '').trim();
      const filtered = dateFilter
        ? bookings.filter((booking) => booking.date === dateFilter)
        : bookings;

      return res.status(200).json(filtered);
    } catch (error) {
      return next(error);
    }
  });

  app.delete(
    '/api/admin/bookings/:id',
    requireAdmin,
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        await adminDb.collection('bookings').doc(id).delete();
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    }
  );

  app.patch('/api/admin/queue/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const parsed = queuePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid queue payload',
            issues: parsed.error.issues,
          });
      }

      await adminDb
        .collection('queue')
        .doc(id)
        .set(parsed.data, { merge: true });
      return res.status(200).json({ id, ...parsed.data });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/admin/queue/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      await adminDb.collection('queue').doc(id).delete();
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  // ── Send queue notification emails (queue writes already done by client) ──
  // Emails the first 2 waiting customers who haven't been notified yet (tracked by queueNotifiedAt).
  // Each person only gets ONE notification email.
  app.post(
    '/api/admin/queue/call-next',
    requireAdmin,
    async (req, res, next) => {
      try {
        const barberId = String(req.body?.barberId || '').trim();
        if (!barberId) {
          return res.status(400).json({ message: 'barberId is required' });
        }

        // Read current queue state (already updated by client-side Firestore writes)
        const queueSnap = await adminDb.collection('queue').get();
        type QueueDoc = {
          id: string;
          barberId: string;
          position: number;
          status: string;
          customerName: string;
          email?: string;
          phone?: string;
          queueNotifiedAt?: string;
        };
        const items = queueSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as QueueDoc)
          .filter((item) => item.barberId === barberId)
          .sort((a, b) => (a.position || 0) - (b.position || 0));

        const waitingItems = items.filter((item) => item.status === 'waiting');

        // Look up barber name
        let barberName = 'Your barber';
        try {
          const barberDoc = await adminDb
            .collection('barbers')
            .doc(barberId)
            .get();
          if (barberDoc.exists) {
            barberName = String(
              (barberDoc.data() as Record<string, unknown>).name || barberName
            );
          }
        } catch {
          /* ignore */
        }

        // Email the first 2 waiting customers who haven't been notified yet
        const notifiedIds: string[] = [];
        for (let i = 0; i < Math.min(waitingItems.length, 2); i++) {
          const customer = waitingItems[i];
          // Skip if already notified
          if (customer.queueNotifiedAt) continue;

          const email = String(customer.email || '').trim();
          if (!email.includes('@')) continue;

          const position = i + 1; // 1 = next, 2 = almost next
          const html = buildWalkinYoureNextEmailHtml({
            customerName: String(customer.customerName || 'Customer'),
            barberName,
            position,
          });

          try {
            const result = await sendBookingActionEmail({
              to: email,
              subject:
                position === 1
                  ? "RK Barbershop - You're Next in Line!"
                  : 'RK Barbershop - Your Turn Is Coming Up!',
              html,
            });
            if (result.sent) {
              // Mark as notified so they don't get emailed again
              await adminDb
                .collection('queue')
                .doc(customer.id)
                .set(
                  { queueNotifiedAt: new Date().toISOString() },
                  { merge: true }
                );
              notifiedIds.push(customer.id);
            }
          } catch {
            /* ignore send errors */
          }
        }

        return res.status(200).json({
          notifiedCount: notifiedIds.length,
          notifiedIds,
          emailSent: notifiedIds.length > 0,
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  app.post('/api/admin/services', requireAdmin, async (req, res, next) => {
    try {
      const parsed = serviceCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid service payload',
            issues: parsed.error.issues,
          });
      }

      const created = await adminDb.collection('services').add(parsed.data);
      return res.status(201).json({ id: created.id, ...parsed.data });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/services/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const parsed = servicePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid service payload',
            issues: parsed.error.issues,
          });
      }

      await adminDb
        .collection('services')
        .doc(id)
        .set(parsed.data, { merge: true });
      return res.status(200).json({ id, ...parsed.data });
    } catch (error) {
      return next(error);
    }
  });

  app.delete(
    '/api/admin/services/:id',
    requireAdmin,
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        await adminDb.collection('services').doc(id).delete();
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    }
  );

  app.post('/api/admin/barbers', requireAdmin, async (req, res, next) => {
    try {
      const parsed = barberCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid barber payload',
            issues: parsed.error.issues,
          });
      }

      const created = await adminDb.collection('barbers').add(parsed.data);
      return res.status(201).json({ id: created.id, ...parsed.data });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/barbers/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const parsed = barberPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid barber payload',
            issues: parsed.error.issues,
          });
      }

      await adminDb
        .collection('barbers')
        .doc(id)
        .set(parsed.data, { merge: true });
      return res.status(200).json({ id, ...parsed.data });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/admin/barbers/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      await adminDb.collection('barbers').doc(id).delete();
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const parsed = settingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            message: 'Invalid settings payload',
            issues: parsed.error.issues,
          });
      }

      await adminDb
        .collection('settings')
        .doc('shop')
        .set(parsed.data, { merge: true });
      return res.status(200).json(parsed.data);
    } catch (error) {
      return next(error);
    }
  });

  // ── Gallery ──────────────────────────────────────────────
  app.post('/api/admin/gallery', requireAdmin, async (req, res, next) => {
    try {
      const data = {
        imageUrl: String(req.body?.imageUrl || ''),
        caption: String(req.body?.caption || ''),
        order: Number(req.body?.order ?? Date.now()),
        createdAt: new Date().toISOString(),
      };
      if (!data.imageUrl)
        return res.status(400).json({ message: 'imageUrl is required' });
      const created = await adminDb.collection('gallery').add(data);
      return res.status(201).json({ id: created.id, ...data });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/admin/gallery/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      await adminDb.collection('gallery').doc(id).delete();
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/gallery/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const update: Record<string, unknown> = {};
      if (req.body?.barberId !== undefined)
        update.barberId = String(req.body.barberId);
      if (req.body?.hairstyleName !== undefined)
        update.hairstyleName = String(req.body.hairstyleName);
      if (req.body?.caption !== undefined)
        update.caption = String(req.body.caption);
      await adminDb.collection('gallery').doc(id).set(update, { merge: true });
      return res.status(200).json({ id, ...update });
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api/{*path}', (_req, res) => {
    return sendNotFound(res, 'API route not found');
  });

  return httpServer;
}
