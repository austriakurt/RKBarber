import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  type Unsubscribe,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  type Barber,
  type Booking,
  type QueueItem,
  type ShopSettings,
  type Service,
  type GalleryItem,
  COLLECTIONS,
} from "./types";

// ──────────────────────────────────────
// Barbers
// ──────────────────────────────────────

export async function getBarbers(): Promise<Barber[]> {
  const q = query(
    collection(db, COLLECTIONS.BARBERS),
    orderBy("order", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Barber);
}

export function onBarbersSnapshot(
  callback: (barbers: Barber[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.BARBERS),
    orderBy("order", "asc")
  );
  return onSnapshot(q, (snap) => {
    const barbers = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Barber
    );
    callback(barbers);
  }, onError);
}

export async function updateBarber(
  id: string,
  data: Partial<Omit<Barber, "id">>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.BARBERS, id), data);
}

export async function addBarber(
  data: Omit<Barber, "id">
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.BARBERS), data);
  return ref.id;
}

export async function deleteBarber(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.BARBERS, id));
}

// ──────────────────────────────────────
// Bookings
// ──────────────────────────────────────

export async function getBookings(): Promise<Booking[]> {
  const q = query(
    collection(db, COLLECTIONS.BOOKINGS),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking);
}

export async function getTodayBookings(): Promise<Booking[]> {
  const today = new Date().toISOString().split("T")[0];
  const q = query(
    collection(db, COLLECTIONS.BOOKINGS),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Booking)
    .filter((b) => b.date === today);
}

export function onBookingsSnapshot(
  callback: (bookings: Booking[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.BOOKINGS),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const bookings = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Booking
    );
    callback(bookings);
  }, onError);
}

export function onTodayBookingsSnapshot(
  callback: (bookings: Booking[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.BOOKINGS),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    // Use local date (not UTC) to match how bookings are stored via date-fns format()
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const bookings = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Booking)
      .filter((b) => b.date === today);
    callback(bookings);
  }, onError);
}

export async function createBooking(
  data: Omit<Booking, "id">
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.BOOKINGS), data);
  return ref.id;
}

export async function updateBooking(
  id: string,
  data: Partial<Omit<Booking, "id">>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.BOOKINGS, id), data);
}

export async function deleteBooking(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.BOOKINGS, id));
}

// ──────────────────────────────────────
// Queue
// ──────────────────────────────────────

export async function getQueue(): Promise<QueueItem[]> {
  const q = query(
    collection(db, COLLECTIONS.QUEUE),
    orderBy("position", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as QueueItem);
}

export function onQueueSnapshot(
  callback: (queue: QueueItem[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.QUEUE),
    orderBy("position", "asc")
  );
  return onSnapshot(q, (snap) => {
    const queue = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as QueueItem)
      .filter((item) => item.status === "waiting" || item.status === "in-progress");
    callback(queue);
  }, onError);
}

export async function addToQueue(
  data: Omit<QueueItem, "id">
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.QUEUE), data);
  return ref.id;
}

export async function updateQueueItem(
  id: string,
  data: Partial<Omit<QueueItem, "id">>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.QUEUE, id), data);
}

export async function removeFromQueue(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.QUEUE, id));
}

// ──────────────────────────────────────
// Settings (singleton document)
// ──────────────────────────────────────

const SETTINGS_DOC_ID = "shop";

export async function getSettings(): Promise<ShopSettings | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.SETTINGS, SETTINGS_DOC_ID));
  if (!snap.exists()) return null;
  return snap.data() as ShopSettings;
}

export function onSettingsSnapshot(
  callback: (settings: ShopSettings | null) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  return onSnapshot(doc(db, COLLECTIONS.SETTINGS, SETTINGS_DOC_ID), (snap) => {
    callback(snap.exists() ? (snap.data() as ShopSettings) : null);
  }, onError);
}

export async function updateSettings(
  data: Partial<ShopSettings>
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.SETTINGS, SETTINGS_DOC_ID), data, {
    merge: true,
  });
}

// ──────────────────────────────────────
// Services
// ──────────────────────────────────────

export async function getServices(): Promise<Service[]> {
  const q = query(collection(db, COLLECTIONS.SERVICES), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Service);
}

export function onServicesSnapshot(
  callback: (services: Service[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTIONS.SERVICES), orderBy("order", "asc"));
  return onSnapshot(q, (snap) => {
    const services = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Service);
    callback(services);
  }, onError);
}

export async function createService(data: Omit<Service, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.SERVICES), data);
  return ref.id;
}

export async function updateService(
  id: string,
  data: Partial<Omit<Service, "id">>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.SERVICES, id), data);
}

export async function deleteService(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.SERVICES, id));
}

// ──────────────────────────────────────
// Gallery
// ──────────────────────────────────────

export function onGallerySnapshot(
  callback: (items: GalleryItem[]) => void,
  onError?: (error: FirestoreError) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTIONS.GALLERY), orderBy("order", "asc"));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GalleryItem);
    callback(items);
  }, onError);
}

export async function getGallery(): Promise<GalleryItem[]> {
  const q = query(collection(db, COLLECTIONS.GALLERY), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GalleryItem);
}
