import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingModal } from "@/components/booking/BookingModal";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

interface NavbarProps {
  onBookClick?: () => void;
}

export function Navbar({ onBookClick }: NavbarProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalBookingOpen, setInternalBookingOpen] = useState(false);
  const [location] = useLocation();

  const navLinks = [
    { label: "Home",     href: "/" },
    { label: "Our Team", href: "/barbers" },
    { label: "Services", href: "/services" },
    { label: "Queue",    href: "/queue" },
    { label: "Location", href: "/location" },
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

    <BookingModal
      open={internalBookingOpen}
      onOpenChange={setInternalBookingOpen}
    />
    </>
  );
}
