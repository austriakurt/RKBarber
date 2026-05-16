import { auth } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type {
  Barber,
  Booking,
  QueueItem,
  Service,
  ShopSettings,
  GalleryItem,
} from '@/lib/types';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function getAuthenticatedUser(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  await new Promise<void>((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });

  return auth.currentUser;
}

async function adminRequest<
  TPayload extends Record<string, unknown> | undefined,
>(method: HttpMethod, path: string, payload?: TPayload): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new Error('Admin authentication required');
  }

  const token = await user.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response;
}

export async function adminUpdateBookingStatus(
  id: string,
  status: Booking['status']
): Promise<void> {
  await adminRequest('PATCH', `/api/admin/bookings/${id}`, { status });
}

export async function adminRescheduleBooking(
  id: string,
  data: { date: string; time: string; reason: string }
): Promise<void> {
  await adminRequest(
    'PATCH',
    `/api/admin/bookings/${id}`,
    data as Record<string, unknown>
  );
}

export async function adminGetBookings(date?: string): Promise<Booking[]> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await adminRequest('GET', `/api/admin/bookings${query}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const body = await response.text();
    throw new Error(
      `Expected JSON response for bookings API but received '${contentType || 'unknown'}'. First bytes: ${body.slice(0, 120)}`
    );
  }

  return (await response.json()) as Booking[];
}

export async function adminDeleteBooking(id: string): Promise<void> {
  await adminRequest('DELETE', `/api/admin/bookings/${id}`);
}

export async function adminUpdateQueueItem(
  id: string,
  data: Partial<Pick<QueueItem, 'status' | 'position'>>
): Promise<void> {
  await adminRequest(
    'PATCH',
    `/api/admin/queue/${id}`,
    data as Record<string, unknown>
  );
}

export async function adminRemoveFromQueue(id: string): Promise<void> {
  await adminRequest('DELETE', `/api/admin/queue/${id}`);
}

export type CallNextResult = {
  notifiedCount: number;
  notifiedIds: string[];
  emailSent: boolean;
};

export async function adminCallNextInQueue(
  barberId: string
): Promise<CallNextResult> {
  const response = await adminRequest('POST', '/api/admin/queue/call-next', {
    barberId,
  });
  return (await response.json()) as CallNextResult;
}

export async function adminCreateService(
  data: Omit<Service, 'id'>
): Promise<void> {
  await adminRequest(
    'POST',
    '/api/admin/services',
    data as Record<string, unknown>
  );
}

export async function adminUpdateService(
  id: string,
  data: Partial<Omit<Service, 'id'>>
): Promise<void> {
  await adminRequest(
    'PATCH',
    `/api/admin/services/${id}`,
    data as Record<string, unknown>
  );
}

export async function adminDeleteService(id: string): Promise<void> {
  await adminRequest('DELETE', `/api/admin/services/${id}`);
}

export async function adminCreateBarber(
  data: Omit<Barber, 'id'>
): Promise<void> {
  await adminRequest(
    'POST',
    '/api/admin/barbers',
    data as Record<string, unknown>
  );
}

export async function adminUpdateBarber(
  id: string,
  data: Partial<Omit<Barber, 'id'>>
): Promise<void> {
  await adminRequest(
    'PATCH',
    `/api/admin/barbers/${id}`,
    data as Record<string, unknown>
  );
}

export async function adminDeleteBarber(id: string): Promise<void> {
  await adminRequest('DELETE', `/api/admin/barbers/${id}`);
}

export async function adminUpdateSettings(
  data: Partial<ShopSettings>
): Promise<void> {
  await adminRequest(
    'PATCH',
    '/api/admin/settings',
    data as Record<string, unknown>
  );
}

// Gallery
export async function adminCreateGalleryItem(
  data: Omit<GalleryItem, 'id'>
): Promise<void> {
  await adminRequest(
    'POST',
    '/api/admin/gallery',
    data as Record<string, unknown>
  );
}

export async function adminDeleteGalleryItem(id: string): Promise<void> {
  await adminRequest('DELETE', `/api/admin/gallery/${id}`);
}

export async function adminUpdateGalleryItem(
  id: string,
  data: Partial<Omit<GalleryItem, 'id'>>
): Promise<void> {
  await adminRequest(
    'PATCH',
    `/api/admin/gallery/${id}`,
    data as Record<string, unknown>
  );
}
