import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { AmbientPageBackground } from "@/components/layout/AmbientPageBackground";
import { BookingModal } from "@/components/booking/BookingModal";
import { useBarbers, useSettings, useServices, useGallery } from "@/hooks/useFirestore";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import AutoScroll from "embla-carousel-auto-scroll";
import {
  Clock, CheckCircle2, Scissors,
  Star,
} from "lucide-react";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

export default function Home() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const { barbers, loading: barbersLoading } = useBarbers();
  const { settings } = useSettings();
  const { services, loading: servicesLoading } = useServices();
  const { gallery } = useGallery();

  const activeBarbers = barbers.filter((b) => b.active);
  const activeServices = services.filter((s) => s.active);
  const pricedServices = activeServices.filter((s) => !s.noPrice);
  const positiveWalkinPrices = pricedServices
    .map((s) => Number(s.walkinPrice ?? s.price ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const lowestPrice = positiveWalkinPrices.length > 0 ? Math.min(...positiveWalkinPrices) : 80;
  const shopName = settings?.shopName || "RK Barbershop";
  const aboutText =
    settings?.aboutText ||
    "Since 2018, RK Barbershop has been delivering premium grooming services in Lemery. We pride ourselves on professional excellence, affordable pricing, and a welcoming atmosphere for every customer.";

  return (
    <AmbientPageBackground className="min-h-screen bg-background selection:bg-primary selection:text-primary-foreground">
      <Navbar onBookClick={() => setBookingOpen(true)} />

      <BookingModal open={bookingOpen} onOpenChange={setBookingOpen} />

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="min-h-screen flex flex-col justify-center pt-24 pb-16">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="max-w-2xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/50 border border-border mb-6">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Est. 2018
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-black mb-6 leading-[1.1] font-heading">
                CLEAN CUTS.<br />
                <span className="text-primary">PROFESSIONAL</span><br />
                BARBERS.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-lg leading-relaxed">
                Experience premium grooming at {shopName}. Book a reservation or
                join our live walk-in queue today.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" type="button" className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg px-8 h-14 rounded-full font-semibold" onClick={() => setBookingOpen(true)}>
                  Book Appointment
                </Button>
                <Button size="lg" type="button" variant="outline" className="text-lg px-8 h-14 rounded-full border-border/50 bg-background/50 backdrop-blur-sm hover:bg-accent/50 transition-colors" asChild>
                  <Link href="/queue">
                    View Live Queue
                  </Link>
                </Button>
                <Button size="lg" type="button" variant="ghost" className="text-lg px-8 h-14 rounded-full hover:bg-accent/50 transition-colors" asChild>
                  <Link href="/services">
                    <Scissors className="w-5 h-5 mr-2" />
                    View Services
                  </Link>
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col items-center gap-6 lg:ml-auto"
            >
              <img src={LogoImg} alt={`${shopName} Logo`} className="w-64 h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 object-contain drop-shadow-[0_0_60px_rgba(242,183,5,0.25)]" />
              <div className="bg-card border border-border/50 shadow-xl rounded-2xl px-5 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-8 duration-700 delay-300">
                <div className="flex items-center gap-3 divide-x divide-border/50">
                  <div className="text-center pr-3">
                    <p className="text-xl font-black text-primary leading-none">{activeBarbers.length}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Barbers</p>
                  </div>
                  <div className="text-center px-3">
                    <p className="text-xl font-black text-primary leading-none">2018</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Est.</p>
                  </div>
                  <div className="text-center pl-3">
                    <p className="text-xl font-black text-primary leading-none">{activeServices.length}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Services</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Gallery Carousel ────────────────────────────────── */}
      {gallery.length > 0 && (
        <section className="py-20 md:py-28 bg-background border-b border-border/30 overflow-hidden">
          <div className="container mx-auto px-4 md:px-6 mb-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <h2 className="text-3xl md:text-4xl font-bold font-heading mb-2">Our Work</h2>
              <p className="text-muted-foreground">Swipe or drag to browse hairstyles groomed by our barbers</p>
            </motion.div>
          </div>
          <div className="relative">
            <Carousel
              opts={{
                align: "start",
                loop: true,
                dragFree: true,
              }}
              plugins={[AutoScroll({ speed: 1.2, stopOnInteraction: false, stopOnMouseEnter: true })]}
              className="w-full"
            >
              <CarouselContent className="ml-0 gap-4">
                {(() => {
                  const displayGallery = gallery.length < 10 
                    ? Array(Math.ceil(10 / gallery.length)).fill(gallery).flat() 
                    : gallery;
                  return displayGallery.map((item, i) => {
                    const bName = barbers.find((b) => b.id === item.barberId)?.name || "";
                    return (
                      <CarouselItem key={`${item.id}-${i}`} className="pl-0 basis-auto first:pl-4">
                        <div className="group shrink-0 w-64 h-64 md:w-80 md:h-80 rounded-2xl overflow-hidden border border-border/30 shadow-lg relative cursor-grab active:cursor-grabbing select-none">
                          <img src={item.imageUrl} alt={item.hairstyleName || "Hairstyle"} className="w-full h-full object-cover pointer-events-none group-hover:scale-105 transition-transform duration-500" draggable={false} />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 py-3 translate-y-0 md:translate-y-full md:group-hover:translate-y-0 transition-transform duration-300 pointer-events-none">
                            <p className="text-sm text-white font-bold truncate">{item.hairstyleName || "Hairstyle"}</p>
                            {bName && <p className="text-xs text-white/70 truncate">by {bName}</p>}
                          </div>
                        </div>
                      </CarouselItem>
                    );
                  });
                })()}
              </CarouselContent>
            </Carousel>
          </div>
        </section>
      )}

      {/* ── About ──────────────────────────────────────────── */}
      <section id="about" className="py-20 md:py-28 bg-card border-b border-border/30">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <h2 className="text-3xl md:text-4xl font-bold font-heading">About {shopName}</h2>
              <p className="text-lg text-muted-foreground leading-relaxed">{aboutText}</p>
              <div className="grid md:grid-cols-3 gap-8 pt-8">
                {[
                  { icon: CheckCircle2, title: "Expert Barbers", desc: `${activeBarbers.length} highly trained professionals dedicated to your grooming.` },
                  { icon: Clock, title: "Quick Service", desc: "Efficient bookings and real-time queue tracking so you always know when to arrive." },
                  { icon: Star, title: "Affordable Rates", desc: `Premium quality at competitive prices. Starting from ₱${lowestPrice}.` },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <motion.div
                    key={title}
                    whileHover={{ y: -4 }}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.1 }}
                    className="p-6 bg-muted/30 rounded-2xl border border-border/50"
                  >
                    <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4 mx-auto">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="py-8 pb-24 md:pb-8 border-t border-border/30 bg-background">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src={LogoImg} alt={shopName} className="w-8 h-8 object-contain" />
            <span className="font-heading font-bold text-lg">{shopName.toUpperCase()}</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground mb-4">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/barbers" className="hover:text-foreground transition-colors">Our Team</Link>
            <Link href="/services" className="hover:text-foreground transition-colors">Services</Link>
            <Link href="/queue" className="hover:text-foreground transition-colors">Live Queue</Link>
            <Link href="/location" className="hover:text-foreground transition-colors">Location</Link>
          </div>
          <p className="text-muted-foreground text-sm">
            &copy; {new Date().getFullYear()} {shopName}. All rights reserved.
          </p>
        </div>
      </footer>

    </AmbientPageBackground>
  );
}
