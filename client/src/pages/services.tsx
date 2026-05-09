import { useState } from "react";
import { motion } from "framer-motion";
import { Scissors, Loader2, Package, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/Navbar";
import { AmbientPageBackground } from "@/components/layout/AmbientPageBackground";
import { BookingModal } from "@/components/booking/BookingModal";
import { useServices, useSettings } from "@/hooks/useFirestore";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

export default function ServicesPage() {
  const { services, loading } = useServices();
  const { settings } = useSettings();
  const [bookingOpen, setBookingOpen] = useState(false);

  const shopName = settings?.shopName || "RK Barbershop";
  const activeServices = services.filter((s) => s.active);
  const soloServices = activeServices.filter((s) => (s.serviceType || "solo") === "solo");
  const packageServices = activeServices.filter((s) => s.serviceType === "package");

  return (
    <AmbientPageBackground className="min-h-screen bg-background">
      <Navbar />

      <BookingModal open={bookingOpen} onOpenChange={setBookingOpen} />

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
              <img src={LogoImg} alt={shopName} className="w-8 h-8 object-contain" />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">What We Offer</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black font-heading mb-4">
              Our <span className="text-primary">Services</span>
            </h1>
            <p className="text-lg text-muted-foreground">
              Browse our full range of grooming services and packages. We offer both walk-in and reservation pricing.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Services Content */}
      <section className="py-16">
        <div className="container mx-auto px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : activeServices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/50">
              <Scissors className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-lg font-medium">No services listed yet.</p>
              <p className="text-sm mt-1">Check back soon!</p>
            </div>
          ) : (
            <div className="space-y-16">
              {/* Solo Services */}
              {soloServices.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Scissors className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold font-heading">Solo Services</h2>
                      <p className="text-sm text-muted-foreground">Individual grooming services</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {soloServices.map((service, idx) => (
                      <motion.div
                        key={service.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: idx * 0.05 }}
                        whileHover={{ y: -3 }}
                        className="bg-card rounded-2xl border border-border/50 hover:border-primary/40 overflow-hidden shadow-sm hover:shadow-lg transition-all group flex flex-col"
                      >
                        <div className="p-6 flex-1 flex flex-col">
                          <div className="flex items-start gap-4 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                              <Scissors className="w-6 h-6 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-lg font-bold font-heading">{service.name}</h3>
                              {service.description && (
                                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{service.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="mt-auto">
                            {!service.noPrice ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-muted/40 p-3 rounded-xl border border-border/30 text-center">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Walk-in</p>
                                  <p className="text-lg font-bold text-primary">₱{Number(service.walkinPrice ?? service.price ?? 0)}</p>
                                </div>
                                <div className="bg-muted/40 p-3 rounded-xl border border-border/30 text-center">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Reserve</p>
                                  <p className="text-lg font-bold text-primary">₱{Number(service.reservationPrice ?? service.price ?? 0)}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-muted/30 p-3 rounded-xl border border-border/30 text-center">
                                <p className="text-sm text-muted-foreground font-medium">Contact for pricing</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Package Services */}
              {packageServices.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Package className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold font-heading">Packages</h2>
                      <p className="text-sm text-muted-foreground">Bundled services at great value</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {packageServices.map((service, idx) => {
                      const includedNames = (service.includedServiceIds || [])
                        .map((id) => services.find((s) => s.id === id)?.name || "")
                        .filter(Boolean);
                      return (
                        <motion.div
                          key={service.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, delay: idx * 0.05 }}
                          whileHover={{ y: -3 }}
                          className="bg-card rounded-2xl border border-primary/20 hover:border-primary/40 overflow-hidden shadow-sm hover:shadow-lg transition-all group flex flex-col relative"
                        >
                          {/* Package badge */}
                          <div className="absolute top-3 right-3 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-primary/20 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            Package
                          </div>
                          <div className="p-6 flex-1 flex flex-col">
                            <div className="flex items-start gap-4 mb-4">
                              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                                <Package className="w-6 h-6 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0 pr-16">
                                <h3 className="text-lg font-bold font-heading">{service.name}</h3>
                                {service.description && (
                                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{service.description}</p>
                                )}
                              </div>
                            </div>
                            {includedNames.length > 0 && (
                              <div className="mb-4 bg-primary/5 border border-primary/10 rounded-xl p-3">
                                <p className="text-[10px] text-primary/70 uppercase tracking-wider font-bold mb-1.5">Includes</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {includedNames.map((name) => (
                                    <span key={name} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium">
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="mt-auto">
                              {!service.noPrice ? (
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30 text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Walk-in</p>
                                    <p className="text-lg font-bold text-primary">₱{Number(service.walkinPrice ?? service.price ?? 0)}</p>
                                  </div>
                                  <div className="bg-muted/40 p-3 rounded-xl border border-border/30 text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Reserve</p>
                                    <p className="text-lg font-bold text-primary">₱{Number(service.reservationPrice ?? service.price ?? 0)}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="bg-muted/30 p-3 rounded-xl border border-border/30 text-center">
                                  <p className="text-sm text-muted-foreground font-medium">Contact for pricing</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* CTA */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-center py-8"
              >
                <div className="bg-card rounded-3xl border border-border/50 p-8 md:p-12 max-w-2xl mx-auto">
                  <h2 className="text-2xl md:text-3xl font-bold font-heading mb-3">Ready to Book?</h2>
                  <p className="text-muted-foreground mb-6">
                    Choose your service and book a reservation or join our live walk-in queue.
                  </p>
                  <Button
                    size="lg"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg px-10 h-14 rounded-full font-semibold"
                    onClick={() => setBookingOpen(true)}
                  >
                    <Scissors className="w-5 h-5 mr-2" />
                    Book Appointment
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 pb-24 md:pb-6 border-t border-border/30 text-center">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {shopName}. All rights reserved.
        </p>
      </footer>

      {/* Sticky mobile CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/80 backdrop-blur-lg border-t border-border/50 p-3">
        <Button
          type="button"
          size="lg"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-12 rounded-xl"
          onClick={() => setBookingOpen(true)}
        >
          Book an Appointment
        </Button>
      </div>
    </AmbientPageBackground>
  );
}
