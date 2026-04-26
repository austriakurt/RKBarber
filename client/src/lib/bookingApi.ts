import type { Booking } from "@/lib/types";

export type CreateBookingPayload = Omit<Booking, "id">;

export type CreateBookingResponse = {
  id: string;
  status: Booking["status"];
  price: number;
  emailSent: boolean;
  emailReason?: string;
};

export async function createPublicBooking(payload: CreateBookingPayload): Promise<CreateBookingResponse> {
  const response = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : { message: await response.text() };
  if (!response.ok) {
    throw new Error(String(body?.message || "Failed to create booking"));
  }

  return body as CreateBookingResponse;
}