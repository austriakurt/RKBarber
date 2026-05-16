// Firestore collection types for RK Barbershop

export const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export interface Service {
  id: string;
  name: string;
  serviceType?: 'solo' | 'package';
  includedServiceIds?: string[];
  description: string;
  price: number;
  walkinPrice?: number;
  reservationPrice?: number;
  noPrice?: boolean;
  duration: number; // minutes
  active: boolean;
  order: number;
  createdAt: string;
}

export interface Barber {
  id: string;
  name: string;
  specialty: string; // derived display string (comma-joined service names)
  services?: string[]; // array of service IDs offered by this barber
  reservePrice: number;
  walkinPrice: number;
  active: boolean;
  image: string;
  order: number;
  availableDays: string[];
  availableFrom: string;
  availableTo: string;
  daysOff?: string[]; // specific ISO dates (yyyy-MM-dd) when barber is off
  createdAt: string;
}

export interface Booking {
  id: string;
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  serviceIds?: string[]; // all selected service IDs
  serviceNames?: string[]; // all selected service names
  customerName: string;
  phone: string;
  email?: string;
  notes: string;
  paymentProofUrl?: string;
  date: string;
  time: string;
  type: 'reservation' | 'walkin';
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  price: number;
  customerDecision?:
    | 'awaiting'
    | 'accepted'
    | 'cancelled'
    | 'reschedule_requested'
    | 'expired';
  customerActionRequired?: boolean;
  customerActionDeadline?: string;
  customerDecisionAt?: string;
  completionRequestedAt?: string;
  completionConfirmedAt?: string;
  completedBy?: 'client' | 'admin';
  forceCompletedAt?: string;
  autoCancelledAt?: string;
  emailNotificationSent?: boolean;
  emailNotificationError?: string;
  rescheduledAt?: string;
  rescheduleReason?: string;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  barberId: string;
  customerName: string;
  phone: string;
  email?: string;
  position: number;
  status: 'waiting' | 'in-progress' | 'done';
  queueNotifiedAt?: string;
  createdAt: string;
}

export interface GalleryItem {
  id: string;
  imageUrl: string;
  caption: string;
  barberId?: string;
  hairstyleName?: string;
  order: number;
  createdAt: string;
}

export interface ShopSettings {
  shopName: string;
  address: string;
  city: string;
  province: string;
  country: string;
  openTime: string;
  closeTime: string;
  operatingDays: string;
  email: string;
  facebookUrl: string;
  tiktokUrl: string;
  googleMapsUrl: string;
  tagline: string;
  aboutText: string;
  // Booking / payment settings
  gcashNumber?: string;
  gcashName?: string;
  gcashAccountName?: string;
  gcashOwnerName?: string;
  gcashDisplayName?: string;
  gcashQrCodeUrl?: string;
  reservationPolicyText?: string;
  combo1ServiceAId?: string;
  combo1ServiceBId?: string;
  combo1WalkinPrice?: number;
  combo1ReservationPrice?: number;
  combo2ServiceAId?: string;
  combo2ServiceBId?: string;
  combo2WalkinPrice?: number;
  combo2ReservationPrice?: number;
}

/**
 * Derive a barber's specialty display string from their selected service IDs.
 * Falls back to the stored `barber.specialty` if no services are matched.
 */
export function getBarberSpecialty(
  barber: Barber,
  services: Service[]
): string {
  if (barber.services && barber.services.length > 0 && services.length > 0) {
    const names = barber.services
      .map((sid) => services.find((s) => s.id === sid)?.name)
      .filter(Boolean) as string[];
    if (names.length > 0) return names.join(', ');
  }
  return barber.specialty || '';
}

export const COLLECTIONS = {
  BARBERS: 'barbers',
  BOOKINGS: 'bookings',
  QUEUE: 'queue',
  SETTINGS: 'settings',
  SERVICES: 'services',
  GALLERY: 'gallery',
} as const;
