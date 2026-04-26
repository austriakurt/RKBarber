import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookingModal } from "@/components/booking/BookingModal";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useServices } from "@/hooks/useFirestore";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

interface NavbarProps {
  onBookClick?: () => void;
  onQueueClick?: () => void;
  onServicesClick?: () => void;
}

export function Navbar({ onBookClick, onServicesClick }: NavbarProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalServicesOpen, setInternalServicesOpen] = useState(false);
  const [internalBookingOpen, setInternalBookingOpen] = useState(false);
  const [location] = useLocation();
  const { services } = useServices();
  const activeServices = services.filter((s) => s.active);

  const openServices = onServicesClick ?? (() => setInternalServicesOpen(true));

  const navLinks = [
    { label: "Home",     href: "/",         anchor: false },
    { label: "Our Team", href: "/barbers",  anchor: false },
    { label: "Location", href: "/location", anchor: false },
  ];

  const linkClass = (href: string) =>
    cn(
      "text-xs font-medium transition-colors",
      location === href
        ? "text-primary"
        : "text-muted-foreground hover:text-foreground"
    );

  const mobileLinkClass = (href: string) =>
    cn(
      "text-sm font-medium p-2.5 rounded-lg transition-colors",
      location === href
        ? "bg-primary/10 text-primary"
        : "hover:bg-accent/50"
    );

  return (
    <>
    <nav className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-border/40">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <img src={LogoImg} alt="RK Barbershop" className="w-7 h-7 object-contain group-hover:scale-105 transition-transform" />
            <span className="font-heading font-bold text-sm tracking-widest uppercase">RK Barbershop</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-5">
            {navLinks.map(({ label, href }) => (
              <Link key={label} href={href} className={linkClass(href)}>{label}</Link>
            ))}
            <div className="flex items-center gap-2 border-l border-border/40 pl-5">
              <Link href="/admin">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground h-8 px-3">Login</Button>
              </Link>
              {onBookClick ? (
                <Button size="sm" onClick={onBookClick} className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold rounded-full h-8 px-4 text-xs">
                  Book Now
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold rounded-full h-8 px-4 text-xs"
                  onClick={() => setInternalBookingOpen(true)}
                >
                  Book Now
                </Button>
              )}
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 text-foreground hover:bg-accent/50 rounded-lg transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? "Close menu" : "Open menu"}
          >
            {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="md:hidden absolute top-14 left-0 w-full bg-background border-b border-border/50 overflow-hidden shadow-2xl"
          >
            <div className="py-3 px-4 flex flex-col gap-1">
              {navLinks.map(({ label, href }) => (
                <Link key={label} href={href} className={mobileLinkClass(href)} onClick={() => setIsOpen(false)}>{label}</Link>
              ))}
              <div className="pt-2 mt-1 border-t border-border/50 flex flex-col gap-2">
                {onBookClick ? (
                  <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { onBookClick(); setIsOpen(false); }}>
                    Book Appointment
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => { setIsOpen(false); setInternalBookingOpen(true); }}
                  >
                    Book Appointment
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild className="w-full hover:bg-accent/50">
                  <Link href="/admin" onClick={() => setIsOpen(false)}>Admin Login</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>

    {/* Internal Services popup (used when no onServicesClick is provided) */}
    <Dialog open={internalServicesOpen} onOpenChange={setInternalServicesOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] bg-card border-border/50 p-0 overflow-hidden flex flex-col">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />
        <div className="px-6 pt-5 pb-6 flex flex-col min-h-0">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-bold font-heading">Our Services</DialogTitle>
          </DialogHeader>
          {activeServices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50">
              <Scissors className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No services listed yet.</p>
            </div>
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              {activeServices.map((service) => (
                <div key={service.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/30 border border-border/30 hover:border-primary/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Scissors className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm break-words">{service.name}</p>
                      {service.description && <p className="text-xs text-muted-foreground leading-relaxed break-words">{service.description}</p>}
                    </div>
                  </div>
                  {!service.noPrice && (
                    <span className="font-bold text-primary shrink-0 text-xs">
                      W ₱{Number(service.walkinPrice ?? service.price ?? 0)} / R ₱{Number(service.reservationPrice ?? service.price ?? 0)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {onBookClick ? (
            <Button
              className="w-full mt-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-semibold"
              onClick={() => { setInternalServicesOpen(false); onBookClick(); }}
            >
              Book Now
            </Button>
          ) : (
            <Button
              className="w-full mt-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-semibold"
              onClick={() => { setInternalServicesOpen(false); setInternalBookingOpen(true); }}
            >
              Book Now
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <BookingModal
      open={internalBookingOpen}
      onOpenChange={setInternalBookingOpen}
    />
    </>
  );
}
