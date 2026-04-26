import { useState, useEffect } from "react";
import {
  onBarbersSnapshot,
  onBookingsSnapshot,
  onTodayBookingsSnapshot,
  onQueueSnapshot,
  onSettingsSnapshot,
  onServicesSnapshot,
  onGallerySnapshot,
} from "@/lib/firestore";
import type { Barber, Booking, QueueItem, ShopSettings, Service, GalleryItem } from "@/lib/types";

export function useBarbers() {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onBarbersSnapshot(
      (data) => { setBarbers(data); setLoading(false); },
      (err) => { console.error("Barbers snapshot error:", err); setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { barbers, loading, error };
}

export function useQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onQueueSnapshot(
      (data) => { setQueue(data); setLoading(false); },
      (err) => { console.error("Queue snapshot error:", err); setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { queue, loading, error };
}

export function useBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onBookingsSnapshot(
      (data) => { setBookings(data); setError(null); setLoading(false); },
      (err) => {
        console.error("Bookings snapshot error:", err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { bookings, loading, error };
}

export function useTodayBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onTodayBookingsSnapshot(
      (data) => { setBookings(data); setError(null); setLoading(false); },
      (err) => {
        console.error("Today bookings snapshot error:", err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { bookings, loading, error };
}

export function useSettings() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSettingsSnapshot(
      (data) => { setSettings(data); setLoading(false); },
      (err) => { console.error("Settings snapshot error:", err); setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { settings, loading, error };
}

export function useServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onServicesSnapshot(
      (data) => { setServices(data); setLoading(false); },
      (err) => { console.error("Services snapshot error:", err); setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { services, loading, error };
}

export function useGallery() {
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onGallerySnapshot(
      (data) => { setGallery(data); setLoading(false); },
      (err) => { console.error("Gallery snapshot error:", err); setError(err.message); setLoading(false); }
    );
    return unsub;
  }, []);

  return { gallery, loading, error };
}
