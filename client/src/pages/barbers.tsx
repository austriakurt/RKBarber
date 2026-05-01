import { useState } from "react";
import { motion } from "framer-motion";
import { Scissors, Clock, Calendar, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/Navbar";
import { AmbientPageBackground } from "@/components/layout/AmbientPageBackground";
import { BookingModal } from "@/components/booking/BookingModal";
import { useBarbers, useServices } from "@/hooks/useFirestore";
import type { Barber } from "@/lib/types";
import { getBarberSpecialty } from "@/lib/types";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function isBarberAvailableNow(barber: Barber): boolean {
  const now = new Date();
  const todayName = DAY_NAMES[now.getDay()];
  if (barber.availableDays && barber.availableDays.length > 0 && !barber.availableDays.includes(todayName)) return false;
  const parse = (t: string) => {
    if (!t) return null;
    const [time, period] = t.split(" ");
    let [h, m] = time.split(":").map(Number);
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + (m || 0);
  };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const open = parse(barber.availableFrom || "9:00 AM");
  const close = parse(barber.availableTo || "8:00 PM");
  if (open !== null && nowMins < open) return false;
  if (close !== null && nowMins >= close) return false;
  return true;
}

export default function BarbersPage() {
  const { barbers, loading } = useBarbers();
  const { services } = useServices();
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  const activeBarbers = barbers.filter((b) => b.active);

  const handleBook = (barber: Barber) => {
    setSelectedBarber(barber);
    setBookingOpen(true);
  };

  return (
    <AmbientPageBackground className="min-h-screen bg-background">
        <Navbar />

        <BookingModal
          open={bookingOpen}
          onOpenChange={setBookingOpen}
          initialBarber={selectedBarber}
        />

        {/* Header */}
        <section className="pt-28 pb-12 border-b border-border/30">
          <div className="container mx-auto px-4 md:px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-2xl"
            >
              <div className="flex items-center gap-3 mb-3">
                <img src={LogoImg} alt="RK Barbershop" className="w-8 h-8 object-contain" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Our Team</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-black font-heading mb-4">
                Meet Our <span className="text-primary">Barbers</span>
              </h1>
              <p className="text-lg text-muted-foreground">
                All our barbers are skilled professionals ready to give you the perfect cut. Select one to book your appointment.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Barbers Grid */}
        <section className="py-16">
        <div className="container mx-auto px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {activeBarbers.map((barber, idx) => (
                <motion.div
                  key={barber.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: idx * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="bg-card rounded-3xl border border-border/50 hover:border-primary/40 overflow-hidden shadow-sm hover:shadow-xl transition-all group flex flex-col"
                >
                  {/* Avatar */}
                  <div className="aspect-[4/3] bg-muted/30 flex items-center justify-center relative overflow-hidden">
                    {barber.image ? (
                      <img
                        src={barber.image}
                        alt={barber.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-4xl font-black text-primary font-heading">
                          {barber.name.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="absolute top-3 right-3">
                      {isBarberAvailableNow(barber) ? (
                        <span className="bg-emerald-500/90 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                          Available
                        </span>
                      ) : (
                        <span className="bg-muted/80 text-muted-foreground text-xs font-semibold px-2.5 py-1 rounded-full border border-border/50">
                          Off Today
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-6 flex flex-col flex-1">
                    <h3 className="text-xl font-bold font-heading mb-1">{barber.name}</h3>
                    {getBarberSpecialty(barber, services) && (
                      <p className="text-sm text-muted-foreground mb-4">{getBarberSpecialty(barber, services)}</p>
                    )}

                    {/* Availability */}
                    <div className="space-y-2 mb-5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {barber.availableFrom || "9:00 AM"} – {barber.availableTo || "8:00 PM"}
                        </span>
                      </div>
                      {barber.availableDays && barber.availableDays.length > 0 && (
                        <div className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          <span>
                            {barber.availableDays.length === 7
                              ? "Every day"
                              : barber.availableDays.map((d) => d.slice(0, 3)).join(", ")}
                          </span>
                        </div>
                      )}
                      {barber.daysOff && barber.daysOff.length > 0 && (
                        <div className="flex items-start gap-2 text-xs">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-amber-500/80 font-medium">Days off:</span>
                            {barber.daysOff.map((d) => {
                              const [yr, mo, dy] = d.split("-").map(Number);
                              const date = new Date(yr, mo - 1, dy);
                              return (
                                <span key={d} className="bg-amber-500/10 border border-amber-500/20 text-amber-500/90 px-1.5 py-0.5 rounded text-[10px] font-medium">
                                  {date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pricing */}
                    <div className="mt-auto">
                      <div className="grid grid-cols-2 gap-3 mb-5">
                        <div className="bg-muted/50 p-3 rounded-xl border border-border/30 text-center">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Reserve</p>
                          <p className="text-lg font-bold">₱{barber.reservePrice}</p>
                        </div>
                        <div className="bg-muted/50 p-3 rounded-xl border border-border/30 text-center">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Walk-in</p>
                          <p className="text-lg font-bold">₱{barber.walkinPrice}</p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full bg-foreground text-background hover:bg-primary hover:text-primary-foreground font-semibold h-11 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleBook(barber)}
                        disabled={!isBarberAvailableNow(barber)}
                        title={!isBarberAvailableNow(barber) ? "This barber is not available today" : undefined}
                      >
                        <Scissors className="w-4 h-4 mr-2" />
                        {isBarberAvailableNow(barber) ? `Book with ${barber.name}` : "Not Available Today"}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
        </section>

        {/* Footer strip */}
        <footer className="py-6 pb-24 md:pb-6 border-t border-border/30 text-center">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} RK Barbershop. All rights reserved.
        </p>
        </footer>

        {/* Sticky mobile CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/80 backdrop-blur-lg border-t border-border/50 p-3">
        <Button
          type="button"
          size="lg"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-12 rounded-xl"
          onClick={() => { setSelectedBarber(null); setBookingOpen(true); }}
        >
          Book an Appointment
        </Button>
        </div>
    </AmbientPageBackground>
  );
}
