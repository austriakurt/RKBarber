import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { Barber, Service } from '@/lib/types';
import { getBarberSpecialty } from '@/lib/types';
import { addToQueue, getQueue } from '@/lib/firestore';
import { createPublicBooking } from '@/lib/bookingApi';
import {
  useBarbers,
  useBookings,
  useServices,
  useQueue,
  useSettings,
} from '@/hooks/useFirestore';
import { format } from 'date-fns';
import {
  CalendarIcon,
  Clock,
  Scissors,
  Loader2,
  CheckCircle2,
  ChevronRight,
  Users,
  AlertCircle,
  Upload,
  Download,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadImageFile } from '@/lib/storageUpload';
import { downloadImageInApp } from '@/lib/fileDownload';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
function generateTimeslots(from: string, to: string): string[] {
  const slots: string[] = [];
  const parseTime = (tStr: string) => {
    if (!tStr) return 0;
    const match = tStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return 0;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return (h || 0) * 60 + (m || 0);
  };
  const formatTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
  };
  const start = parseTime(from || '9:00 AM');
  const end = parseTime(to || '8:00 PM');
  for (let t = start; t < end; t += 60) slots.push(formatTime(t));
  return slots;
}

function isValidPHPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
}

/** Returns true if the barber's schedule covers today's day AND current time is within their hours. */
function isBarberAvailableNow(barber: Barber): boolean {
  const now = new Date();
  const todayName = DAY_NAMES[now.getDay()];
  const workDays = barber.availableDays;
  if (workDays && workDays.length > 0 && !workDays.includes(todayName))
    return false;

  // Check admin-set specific days off
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (barber.daysOff && barber.daysOff.includes(todayISO)) return false;

  // Parse time helper (returns minutes since midnight)
  const parseTime = (t: string) => {
    if (!t) return null;
    const [time, period] = t.split(' ');
    let [h, m] = time.split(':').map(Number);
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + (m || 0);
  };

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins = parseTime(barber.availableFrom || '9:00 AM');
  const closeMins = parseTime(barber.availableTo || '8:00 PM');
  if (openMins !== null && nowMins < openMins) return false;
  if (closeMins !== null && nowMins >= closeMins) return false;

  return true;
}

const TOTAL_STEPS = 7;
const STEP_LABELS = [
  'Service Type',
  'Your Details',
  'Choose Barber',
  'Services',
  'Schedule',
  'Booking Policy',
  'Confirm',
];

interface BookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBarber?: Barber | null;
}

export function BookingModal({
  open,
  onOpenChange,
  initialBarber,
}: BookingModalProps) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<'reservation' | 'walkin'>('reservation');
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(
    initialBarber ?? null
  );
  const [serviceTab, setServiceTab] = useState<'solo' | 'package'>('solo');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState<string>();
  const [notes, setNotes] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const [paymentProofError, setPaymentProofError] = useState('');
  const paymentProofInputRef = useRef<HTMLInputElement | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageTitle, setPreviewImageTitle] = useState('Image Preview');
  const [phoneError, setPhoneError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { barbers } = useBarbers();
  const { bookings } = useBookings();
  const { services } = useServices();
  const { queue } = useQueue();
  const { settings } = useSettings();
  const { toast } = useToast();

  const gcashNumber = settings?.gcashNumber || '09263746324';
  const gcashName = String(
    settings?.gcashName ||
      (settings as any)?.gcashAccountName ||
      (settings as any)?.gcashOwnerName ||
      (settings as any)?.gcashDisplayName ||
      ''
  ).trim();
  const gcashQrCodeUrl = settings?.gcashQrCodeUrl || '';

  const activeBarbers = barbers.filter((b) => b.active);
  const activeServices = services.filter((s) => s.active);
  const soloServices = activeServices.filter(
    (service) => (service.serviceType || 'solo') === 'solo'
  );
  const packageServices = activeServices.filter(
    (service) => service.serviceType === 'package'
  );
  const selectedService =
    services.find((service) => service.id === selectedServiceId) || null;
  const selectedServices = selectedService ? [selectedService] : [];

  const getServicePriceByType = (service: Service): number => {
    if (service.noPrice) return 0;
    const typeSpecific =
      type === 'reservation'
        ? Number(service.reservationPrice ?? service.price ?? 0)
        : Number(service.walkinPrice ?? service.price ?? 0);
    return Number.isFinite(typeSpecific) && typeSpecific > 0 ? typeSpecific : 0;
  };

  const totalPrice = selectedService
    ? getServicePriceByType(selectedService)
    : 0;
  const hasPayablePrice = totalPrice > 0;

  const resetForm = () => {
    setStep(1);
    setType('reservation');
    setSelectedBarber(initialBarber ?? null);
    setServiceTab('solo');
    setSelectedServiceId('');
    setDate(undefined);
    setTime(undefined);
    setNotes('');
    setPolicyAccepted(false);
    setName('');
    setPhone('');
    setEmail('');
    setPaymentProofUrl('');
    setPaymentProofUploading(false);
    setPaymentProofError('');
    setPreviewImageUrl(null);
    setPreviewImageTitle('Image Preview');
    setPhoneError('');
  };

  useEffect(() => {
    if (!open) return;
    setSelectedBarber(initialBarber ?? null);
  }, [open, initialBarber]);

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(resetForm, 400);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 1:
        return true;
      case 2: {
        if (!name.trim()) return false;
        if (!isValidPHPhone(phone)) return false;
        if (!email.includes('@')) return false;
        return true;
      }
      case 3:
        return (
          !!selectedBarber &&
          (type !== 'walkin' || isBarberAvailableNow(selectedBarber))
        );
      case 4:
        return !!selectedServiceId;
      case 5:
        return type === 'walkin' || (!!date && !!time);
      case 6: {
        if (!policyAccepted) return false;
        if (type === 'reservation' && hasPayablePrice && !paymentProofUrl)
          return false;
        return true;
      }
      default:
        return true;
    }
  };

  const handleConfirm = async () => {
    if (!selectedBarber || !selectedService) return;
    setSubmitting(true);
    try {
      const bookingDate =
        type === 'reservation' && date
          ? format(date, 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd');

      const bookingResult = await createPublicBooking({
        barberId: selectedBarber.id,
        barberName: selectedBarber.name,
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        serviceIds: [selectedService.id],
        serviceNames: [selectedService.name],
        customerName: name,
        phone,
        email,
        notes,
        paymentProofUrl: paymentProofUrl || '',
        date: bookingDate,
        time: type === 'reservation' && time ? time : '',
        type,
        status: type === 'reservation' ? 'pending' : 'confirmed',
        price: totalPrice,
        createdAt: new Date().toISOString(),
      } as any);

      if (type === 'walkin') {
        const currentQueue = await getQueue();
        const barberQ = currentQueue.filter(
          (q) => q.barberId === selectedBarber.id && q.status !== 'done'
        );
        await addToQueue({
          barberId: selectedBarber.id,
          customerName: name,
          phone,
          email,
          position: barberQ.length + 1,
          status: 'waiting',
          createdAt: new Date().toISOString(),
        });
      }

      toast({
        title: 'Booking Submitted!',
        description:
          type === 'reservation'
            ? hasPayablePrice
              ? `Reservation submitted. Priority: send ₱${totalPrice} via GCash ${gcashNumber} first and upload proof. Email updates are sent after admin review (approve/cancel/reschedule).`
              : 'Reservation submitted. Email updates are sent after admin review (approve/cancel/reschedule).'
            : `You've been added to ${selectedBarber.name}'s queue.`,
      });
      handleClose();
    } catch {
      toast({
        title: 'Booking Failed',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const barberQueueCount = selectedBarber
    ? queue.filter(
        (q) => q.barberId === selectedBarber.id && q.status !== 'done'
      ).length
    : 0;

  const timeslots = generateTimeslots(
    selectedBarber?.availableFrom || '9:00 AM',
    selectedBarber?.availableTo || '8:00 PM'
  );

  const selectedDateKey = date ? format(date, 'yyyy-MM-dd') : '';
  const availableSlots = useMemo(() => {
    if (type !== 'reservation' || !date) return [];

    const parseTimeStr = (tStr: string) => {
      if (!tStr) return 0;
      const match = tStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!match) return 0;
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const period = match[3]?.toUpperCase();
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return (h || 0) * 60 + (m || 0);
    };

    const isToday =
      format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const dayBookings = bookings.filter(
      (booking) =>
        booking.type === 'reservation' &&
        booking.barberId === selectedBarber?.id &&
        booking.date === selectedDateKey &&
        (booking.status === 'pending' || booking.status === 'confirmed') &&
        !!booking.time
    );

    const bookingIntervals = dayBookings.map((b) => {
      const bStart = parseTimeStr(b.time);
      const bService = services.find((s) => s.id === b.serviceId);
      const bDuration = bService?.duration || 60;
      return { start: bStart, end: bStart + bDuration };
    });

    const closeMins = parseTimeStr(selectedBarber?.availableTo || '8:00 PM');
    const selDuration = selectedService?.duration || 60;

    return timeslots.filter((t) => {
      const tMins = parseTimeStr(t);

      // 1. Past timeslots today are unavailable
      if (isToday && tMins <= nowMins) return false;

      // 2. Appointment must end before or at closing time
      if (tMins + selDuration > closeMins) return false;

      // 3. Overlap check with existing bookings
      const newApptStart = tMins;
      const newApptEnd = tMins + selDuration;

      for (const interval of bookingIntervals) {
        if (
          Math.max(newApptStart, interval.start) <
          Math.min(newApptEnd, interval.end)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    type,
    date,
    timeslots,
    bookings,
    selectedBarber?.id,
    selectedDateKey,
    services,
    selectedService?.duration,
    selectedBarber?.availableTo,
  ]);

  const availableSlotCount = availableSlots.length;

  useEffect(() => {
    if (type !== 'reservation') return;
    if (!time) return;
    if (availableSlots.includes(time)) return;
    setTime(undefined);
  }, [type, time, availableSlots]);

  const toggleService = (service: Service) => {
    setSelectedServiceId((prev) => (prev === service.id ? '' : service.id));
  };

  const shouldSkipBarberStep =
    !!initialBarber &&
    !!selectedBarber &&
    selectedBarber.id === initialBarber.id &&
    (type !== 'walkin' || isBarberAvailableNow(selectedBarber));

  const goNextStep = () => {
    setStep((current) => {
      if (current === 2 && shouldSkipBarberStep) return 4;
      return current + 1;
    });
  };

  const goPreviousStep = () => {
    setStep((current) => {
      if (current === 4 && shouldSkipBarberStep) return 2;
      return current - 1;
    });
  };

  const handlePaymentProofUpload = async (file: File) => {
    setPaymentProofError('');
    setPaymentProofUploading(true);
    try {
      const imageUrl = await uploadImageFile({
        file,
        folder: 'proofs',
        prefix: `booking-${Date.now()}`,
        onCompress: () =>
          toast({
            title: `Compressed payment proof`,
            description: 'File exceeded 3MB and was automatically compressed.',
          }),
      });
      setPaymentProofUrl(imageUrl);
      toast({ title: 'Payment proof uploaded' });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to upload payment proof';
      setPaymentProofError(message);
      toast({ title: message, variant: 'destructive' });
    } finally {
      setPaymentProofUploading(false);
    }
  };

  const openPreviewImage = (url: string, title: string) => {
    setPreviewImageTitle(title);
    setPreviewImageUrl(url);
  };

  const handleDownloadInApp = async (url: string, filename: string) => {
    try {
      await downloadImageInApp(url, filename);
      toast({ title: 'Download started' });
    } catch {
      toast({ title: 'Failed to download file', variant: 'destructive' });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border/50 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/30">
            <DialogTitle className="text-xl flex items-center gap-2 font-heading">
              <Scissors className="w-5 h-5 text-primary" />
              {type === 'walkin' ? 'Walk-In' : 'Book Appointment'}
            </DialogTitle>
            <div className="space-y-1.5 mt-3">
              <div className="flex gap-1">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-all duration-500',
                      step > i + 1
                        ? 'bg-primary'
                        : step === i + 1
                          ? 'bg-primary/60'
                          : 'bg-muted'
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Step {step} / {TOTAL_STEPS} — {STEP_LABELS[step - 1]}
              </p>
            </div>
          </DialogHeader>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
              >
                {/* ── Step 1: Type ── */}
                {step === 1 && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      How would you like to visit?
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {(['reservation', 'walkin'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setType(t)}
                          className={cn(
                            'flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02]',
                            type === t
                              ? 'border-primary bg-primary/10 shadow-md'
                              : 'border-border/50 bg-muted/20 hover:border-primary/40'
                          )}
                        >
                          {t === 'reservation' ? (
                            <Clock
                              className={cn(
                                'w-7 h-7',
                                type === t
                                  ? 'text-primary'
                                  : 'text-muted-foreground'
                              )}
                            />
                          ) : (
                            <Users
                              className={cn(
                                'w-7 h-7',
                                type === t
                                  ? 'text-primary'
                                  : 'text-muted-foreground'
                              )}
                            />
                          )}
                          <div className="text-center">
                            <p className="font-semibold text-sm">
                              {t === 'reservation' ? 'Reservation' : 'Walk-in'}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t === 'reservation'
                                ? 'Pick date & time'
                                : 'Join live queue'}
                            </p>
                          </div>
                          {type === t && (
                            <CheckCircle2 className="w-4 h-4 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Step 2: Contact Details ── */}
                {step === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Enter your contact information
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-name">Full Name *</Label>
                      <Input
                        id="modal-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Juan Dela Cruz"
                        className="bg-input/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-phone">
                        Phone Number *{' '}
                        <span className="text-xs text-muted-foreground font-normal">
                          (09XX or +63)
                        </span>
                      </Label>
                      <Input
                        id="modal-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          if (phoneError) setPhoneError('');
                        }}
                        onBlur={() => {
                          if (phone && !isValidPHPhone(phone))
                            setPhoneError(
                              'Enter a valid PH number: 09XXXXXXXXX or +639XXXXXXXXX'
                            );
                        }}
                        placeholder="09XX XXX XXXX"
                        className={cn(
                          'bg-input/50 border-border/50',
                          phoneError && 'border-red-500'
                        )}
                      />
                      {phoneError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />{' '}
                          {phoneError}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-email">
                        Email Address *{' '}
                        <span className="text-xs text-muted-foreground font-normal">
                          {type === 'reservation'
                            ? '(for booking status updates)'
                            : '(for queue turn updates)'}
                        </span>
                      </Label>
                      <Input
                        id="modal-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="bg-input/50 border-border/50"
                      />
                    </div>
                  </div>
                )}

                {/* ── Step 3: Barber ── */}
                {step === 3 && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {type === 'walkin'
                        ? 'Choose your barber — only available barbers are selectable'
                        : 'Choose your barber'}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {activeBarbers.map((barber) => {
                        const availableNow =
                          type !== 'walkin' || isBarberAvailableNow(barber);
                        const isSelected = selectedBarber?.id === barber.id;
                        return (
                          <button
                            key={barber.id}
                            type="button"
                            disabled={!availableNow}
                            onClick={() => {
                              if (!availableNow) return;
                              setSelectedBarber(barber);
                              setDate(undefined);
                              setTime(undefined);
                            }}
                            className={cn(
                              'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 relative',
                              !availableNow
                                ? 'border-border/20 bg-muted/10 opacity-45 cursor-not-allowed'
                                : isSelected
                                  ? 'border-primary bg-primary/10 shadow-md hover:scale-[1.02]'
                                  : 'border-border/50 bg-muted/20 hover:border-primary/40 hover:scale-[1.02]'
                            )}
                          >
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/20 overflow-hidden">
                              {barber.image ? (
                                <img
                                  src={barber.image}
                                  alt={barber.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-lg font-bold text-primary">
                                  {barber.name.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="text-center">
                              <p className="font-semibold text-sm">
                                {barber.name}
                              </p>
                              {getBarberSpecialty(barber, services) && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                  {getBarberSpecialty(barber, services)}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground/70 mt-1">
                                {(barber.availableDays || DAY_NAMES.slice(1))
                                  .map((d) => d.slice(0, 2))
                                  .join(' · ')}
                              </p>
                              {!availableNow && (
                                <p className="text-xs text-red-400/80 mt-1 font-medium">
                                  Not available today
                                </p>
                              )}
                            </div>
                            {isSelected && availableNow && (
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Step 4: Services (single-select with Solo/Package tabs) ── */}
                {step === 4 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Choose one service option
                    </p>
                    <div className="inline-flex rounded-xl border border-border/50 bg-muted/20 p-1">
                      <button
                        type="button"
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-lg font-semibold',
                          serviceTab === 'solo'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground'
                        )}
                        onClick={() => {
                          setServiceTab('solo');
                          setSelectedServiceId('');
                        }}
                      >
                        Solo
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-lg font-semibold',
                          serviceTab === 'package'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground'
                        )}
                        onClick={() => {
                          setServiceTab('package');
                          setSelectedServiceId('');
                        }}
                      >
                        Package
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(serviceTab === 'solo'
                        ? soloServices
                        : packageServices
                      ).map((service) => {
                        const isSelected = selectedServiceId === service.id;
                        const servicePrice = getServicePriceByType(service);
                        const showServicePrice =
                          !service.noPrice && servicePrice > 0;
                        const includedNames = (service.includedServiceIds || [])
                          .map(
                            (id) =>
                              services.find((s) => s.id === id)?.name || ''
                          )
                          .filter(Boolean)
                          .join(' + ');
                        return (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => toggleService(service)}
                            className={cn(
                              'w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left hover:scale-[1.01]',
                              isSelected
                                ? 'border-primary bg-primary/10 shadow-sm'
                                : 'border-border/50 bg-muted/20 hover:border-primary/40'
                            )}
                          >
                            <div
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                                isSelected
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/40'
                              )}
                            >
                              {isSelected && (
                                <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm">
                                {service.name}
                              </p>
                              {service.description && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {service.description}
                                </p>
                              )}
                              {service.serviceType === 'package' &&
                                includedNames && (
                                  <p className="text-xs text-primary/80 mt-0.5">
                                    Includes: {includedNames}
                                  </p>
                                )}
                            </div>
                            <div className="text-xs font-semibold text-primary shrink-0">
                              {showServicePrice
                                ? `₱${servicePrice}`
                                : 'No price'}
                            </div>
                          </button>
                        );
                      })}
                      {(serviceTab === 'solo' ? soloServices : packageServices)
                        .length === 0 && (
                        <div className="text-xs text-muted-foreground rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                          No {serviceTab} services yet.
                        </div>
                      )}
                    </div>
                    {selectedService && (
                      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-sm flex justify-between">
                        <span className="text-muted-foreground">
                          Selected{' '}
                          {selectedService.serviceType === 'package'
                            ? 'Package'
                            : 'Solo Service'}
                        </span>
                        <span className="font-bold text-primary">
                          ₱{totalPrice}
                        </span>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Notes (Optional)</Label>
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            notes.length >= 260
                              ? 'text-amber-500'
                              : 'text-muted-foreground'
                          )}
                        >
                          {notes.length}/280
                        </span>
                      </div>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value.slice(0, 280))}
                        placeholder="Specific style, preferences, or requests..."
                        rows={2}
                        maxLength={280}
                        className="w-full rounded-xl border border-border/50 bg-input/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                )}

                {/* ── Step 5: Schedule ── */}
                {step === 5 && (
                  <div>
                    {type === 'walkin' ? (
                      <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-lg">
                            Joining Today's Queue
                          </h4>
                          <p className="text-muted-foreground text-sm mt-1 max-w-[260px] mx-auto">
                            You'll be added to{' '}
                            <strong>{selectedBarber?.name}</strong>'s queue
                            right after confirming.
                          </p>
                        </div>
                        <div className="bg-muted/30 border border-border/50 rounded-2xl px-8 py-4">
                          <p className="text-3xl font-bold">
                            {barberQueueCount}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            currently in queue
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Pick your date and time
                        </p>
                        <div className="space-y-1.5">
                          <Label>Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/50 bg-input/50 text-sm text-left hover:border-primary/50 transition-colors',
                                  !date && 'text-muted-foreground'
                                )}
                              >
                                <CalendarIcon className="w-4 h-4 shrink-0" />
                                {date
                                  ? format(date, 'MMMM d, yyyy')
                                  : 'Pick a date'}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-0 border-border/50"
                              align="start"
                            >
                              <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(d) => {
                                  setDate(d);
                                  setTime(undefined);
                                }}
                                initialFocus
                                className="bg-card"
                                disabled={(d) => {
                                  if (
                                    d <
                                    new Date(new Date().setHours(0, 0, 0, 0))
                                  )
                                    return true;
                                  const dayName = DAY_NAMES[d.getDay()];
                                  const workDays =
                                    selectedBarber?.availableDays;
                                  if (
                                    workDays &&
                                    workDays.length > 0 &&
                                    !workDays.includes(dayName)
                                  )
                                    return true;
                                  const dateStr = format(d, 'yyyy-MM-dd');
                                  if (
                                    selectedBarber?.daysOff?.includes(dateStr)
                                  )
                                    return true;
                                  return false;
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label>Time Slot</Label>
                            {type === 'reservation' && date && (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                                </span>
                                <span className="text-green-500 font-medium">
                                  {availableSlotCount} of {timeslots.length}{' '}
                                  available
                                </span>
                              </span>
                            )}
                          </div>
                          <Select
                            value={time}
                            onValueChange={setTime}
                            disabled={!date}
                          >
                            <SelectTrigger className="w-full bg-input/50 border-border/50 h-11">
                              <SelectValue
                                placeholder={
                                  date ? 'Select a time' : 'Pick a date first'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {availableSlots.length > 0 ? (
                                availableSlots.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="py-4 px-2 text-sm text-center text-muted-foreground">
                                  No slots available
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                          {type === 'reservation' &&
                            date &&
                            timeslots.length - availableSlots.length > 0 && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                                </span>
                                {timeslots.length - availableSlots.length} slot
                                {timeslots.length - availableSlots.length > 1
                                  ? 's'
                                  : ''}{' '}
                                unavailable
                              </p>
                            )}
                          {selectedBarber && (
                            <p className="text-xs text-muted-foreground">
                              Available{' '}
                              {selectedBarber.availableFrom || '9:00 AM'} –{' '}
                              {selectedBarber.availableTo || '8:00 PM'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 6: Booking Policy ── */}
                {step === 6 && (
                  <div className="space-y-4">
                    {type === 'reservation' ? (
                      <>
                        <p className="text-sm font-semibold">
                          Our Booking Policy
                        </p>
                        <div className="bg-muted/30 border border-border/50 rounded-2xl p-4 space-y-2.5 text-sm leading-relaxed max-h-56 overflow-y-auto">
                          {settings?.reservationPolicyText ? (
                            <>
                              <p className="text-muted-foreground whitespace-pre-line">
                                {settings.reservationPolicyText}
                              </p>
                              <div className="border-t border-border/30 pt-2.5">
                                <p className="font-semibold mb-1">
                                  Booking Updates
                                </p>
                                <p className="text-muted-foreground">
                                  Booking approval, cancellation, and
                                  rescheduling are handled by admin. We will
                                  email you once your reservation is approved,
                                  cancelled, or rescheduled.
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-muted-foreground">
                                After scheduling an appointment, kindly wait for
                                confirmation.
                              </p>
                              {hasPayablePrice && (
                                <div className="border-t border-border/30 pt-2.5">
                                  <>
                                    <p className="font-semibold text-amber-500 mb-1">
                                      Down Payment Required
                                    </p>
                                    <p className="text-muted-foreground">
                                      To secure your slot, a{' '}
                                      <span className="font-semibold text-foreground">
                                        ₱{totalPrice}
                                      </span>{' '}
                                      down payment is required as a reservation
                                      fee.
                                    </p>
                                    <p className="text-red-400 font-semibold mt-1">
                                      NON-REFUNDABLE
                                    </p>
                                  </>
                                </div>
                              )}
                              {hasPayablePrice && (
                                <div className="border-t border-border/30 pt-2.5">
                                  <p className="font-semibold">
                                    No reservation fee = No confirmed booking
                                  </p>
                                </div>
                              )}
                              <div className="border-t border-border/30 pt-2.5">
                                <p className="font-semibold mb-1">
                                  Booking Updates
                                </p>
                                <p className="text-muted-foreground">
                                  Booking approval, cancellation, and
                                  rescheduling are handled by admin. We will
                                  email you once your reservation is approved,
                                  cancelled, or rescheduled.
                                </p>
                              </div>
                            </>
                          )}
                          {/* Keep policy box text-only; payment details are shown in separate card below */}
                          {settings?.reservationPolicyText &&
                            hasPayablePrice && (
                              <div className="border-t border-border/30 pt-2.5">
                                <p className="font-semibold text-amber-500 mb-1">
                                  Down Payment: ₱{totalPrice}
                                </p>
                              </div>
                            )}
                        </div>
                        {hasPayablePrice && (
                          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3 space-y-2">
                            <p className="text-xs font-semibold text-primary">
                              Official GCash QR
                            </p>
                            <div className="bg-background/70 border border-border/40 rounded-lg px-3 py-2">
                              <p className="text-xs text-muted-foreground">
                                GCash Number
                              </p>
                              <p className="text-sm font-semibold text-foreground">
                                {gcashNumber}
                              </p>
                              {gcashName && (
                                <>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    GCash Name
                                  </p>
                                  <p className="text-sm font-semibold text-foreground">
                                    {gcashName}
                                  </p>
                                </>
                              )}
                            </div>
                            {gcashQrCodeUrl ? (
                              <>
                                <img
                                  src={gcashQrCodeUrl}
                                  alt="RK Barbershop official GCash QR"
                                  className="w-full max-h-52 object-contain rounded-md border border-border/40 bg-background"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openPreviewImage(
                                        gcashQrCodeUrl,
                                        'GCash QR Preview'
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                                  >
                                    <ImageIcon className="w-3.5 h-3.5" /> View
                                    QR
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDownloadInApp(
                                        gcashQrCodeUrl,
                                        'rkbarbershop-gcash-qr.png'
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                                  >
                                    <Download className="w-3.5 h-3.5" />{' '}
                                    Download QR
                                  </button>
                                </div>
                              </>
                            ) : (
                              <p className="text-xs text-amber-600">
                                QR is not uploaded yet. Please contact shop
                                admin before paying.
                              </p>
                            )}
                          </div>
                        )}
                        {hasPayablePrice && (
                          <div className="space-y-2">
                            <Label htmlFor="modal-proof">
                              Upload GCash Payment Proof *
                            </Label>
                            <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
                              <input
                                ref={paymentProofInputRef}
                                id="modal-proof"
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => {
                                  const selected = e.target.files?.[0];
                                  if (selected)
                                    void handlePaymentProofUpload(selected);
                                }}
                                disabled={paymentProofUploading}
                                className="hidden"
                              />
                              {(!paymentProofUrl || paymentProofUploading) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full justify-center border-border/60"
                                  onClick={() =>
                                    paymentProofInputRef.current?.click()
                                  }
                                  disabled={paymentProofUploading}
                                >
                                  {paymentProofUploading ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  ) : (
                                    <Upload className="w-4 h-4 mr-2" />
                                  )}
                                  {paymentProofUploading
                                    ? 'Uploading...'
                                    : 'Choose Payment Proof'}
                                </Button>
                              )}
                              <p className="text-xs text-muted-foreground">
                                PNG, JPG, or WebP. Max 3MB.
                              </p>
                              {paymentProofError && (
                                <p className="text-xs text-red-500 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 shrink-0" />{' '}
                                  {paymentProofError}
                                </p>
                              )}
                              {paymentProofUrl && (
                                <div className="space-y-2">
                                  <img
                                    src={paymentProofUrl}
                                    alt="Uploaded payment proof"
                                    className="w-full max-h-56 object-contain rounded-lg border border-border/40 bg-background"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openPreviewImage(
                                          paymentProofUrl,
                                          'Payment Proof Preview'
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                                    >
                                      <ImageIcon className="w-3.5 h-3.5" /> View
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleDownloadInApp(
                                          paymentProofUrl,
                                          'payment-proof.png'
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                                    >
                                      <Download className="w-3.5 h-3.5" />{' '}
                                      Download
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPaymentProofUrl('');
                                        setPaymentProofError('');
                                      }}
                                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                                    >
                                      <Upload className="w-3.5 h-3.5" /> Replace
                                    </button>
                                  </div>
                                </div>
                              )}
                              {!paymentProofUrl && !paymentProofUploading && (
                                <p className="text-xs text-amber-600">
                                  Reservation confirmation requires an uploaded
                                  proof of GCash payment.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={policyAccepted}
                            onChange={(e) =>
                              setPolicyAccepted(e.target.checked)
                            }
                            className="mt-0.5 w-4 h-4 accent-primary"
                          />
                          <span className="text-sm text-muted-foreground leading-snug">
                            {hasPayablePrice
                              ? `I have read and agree to the booking policy, including the non-refundable ₱${totalPrice} down payment.`
                              : 'I have read and agree to the booking policy.'}
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold">Walk-in Policy</p>
                        <div className="bg-muted/30 border border-border/50 rounded-2xl p-4 space-y-2 text-sm text-muted-foreground">
                          <p>
                            You'll be added to the live queue. No down payment
                            is required for walk-ins.
                          </p>
                          <p>
                            Reservations are prioritized at their scheduled time
                            before walk-ins.
                          </p>
                          <p>
                            Queue position may change depending on arrivals.
                            Please arrive on time.
                          </p>
                          <p className="text-xs">
                            Paalala: Mas inuuna ang may reservation kapag oras
                            na ng schedule nila.
                          </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={policyAccepted}
                            onChange={(e) =>
                              setPolicyAccepted(e.target.checked)
                            }
                            className="mt-0.5 w-4 h-4 accent-primary"
                          />
                          <span className="text-sm text-muted-foreground">
                            I understand the walk-in policy.
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                )}

                {/* ── Step 7: Confirm ── */}
                {step === 7 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Review your booking
                    </p>
                    <div className="bg-muted/30 rounded-2xl p-4 space-y-3 border border-border/50">
                      {[
                        {
                          label: 'Type',
                          value:
                            type === 'walkin' ? 'Walk-in Queue' : 'Reservation',
                        },
                        { label: 'Barber', value: selectedBarber?.name },
                        {
                          label: 'Service Category',
                          value:
                            selectedService?.serviceType === 'package'
                              ? 'Package'
                              : 'Solo',
                        },
                        {
                          label: 'Service',
                          value: selectedService?.name || '',
                        },
                        { label: 'Price', value: `₱${totalPrice}` },
                        { label: 'Customer', value: name },
                        { label: 'Phone', value: phone },
                        ...(email ? [{ label: 'Email', value: email }] : []),
                        ...(paymentProofUrl
                          ? [{ label: 'Payment Proof', value: 'Uploaded' }]
                          : []),
                        ...(type === 'reservation' && date && time
                          ? [
                              {
                                label: 'Schedule',
                                value: `${format(date, 'MMM d, yyyy')} at ${time}`,
                              },
                            ]
                          : []),
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="flex justify-between items-start text-sm border-b border-border/30 pb-2.5 last:border-0 last:pb-0"
                        >
                          <span className="text-muted-foreground shrink-0 mr-4">
                            {label}
                          </span>
                          <span className="font-medium text-right break-words max-w-[65%]">
                            {value}
                          </span>
                        </div>
                      ))}
                      {notes && (
                        <div className="text-sm border-b border-border/30 pb-2.5">
                          <span className="text-muted-foreground block mb-1.5">
                            Notes
                          </span>
                          <div className="bg-muted/40 border border-border/30 rounded-xl px-3 py-2 max-h-20 overflow-y-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
                            {notes}
                          </div>
                        </div>
                      )}
                      {hasPayablePrice && (
                        <div className="flex justify-between items-center pt-1.5 text-base border-t border-border/50 mt-1">
                          <span className="font-semibold">Total</span>
                          <span className="font-bold text-primary text-xl">
                            ₱{totalPrice}
                          </span>
                        </div>
                      )}
                    </div>
                    {type === 'reservation' && hasPayablePrice && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-amber-600 space-y-2">
                          <p>
                            Send <strong>₱{totalPrice}</strong> via GCash{' '}
                            <strong>{gcashNumber}</strong> and upload the proof
                            above.
                          </p>
                          {gcashName && (
                            <p>
                              Account Name: <strong>{gcashName}</strong>
                            </p>
                          )}
                          {gcashQrCodeUrl && (
                            <div className="space-y-2">
                              <img
                                src={gcashQrCodeUrl}
                                alt="RK Barbershop GCash QR"
                                className="w-full max-h-52 object-contain rounded-md border border-amber-500/20 bg-background"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openPreviewImage(
                                      gcashQrCodeUrl,
                                      'GCash QR Preview'
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-amber-500/30 hover:bg-amber-500/10"
                                >
                                  <ImageIcon className="w-3.5 h-3.5" /> View QR
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDownloadInApp(
                                      gcashQrCodeUrl,
                                      'rkbarbershop-gcash-qr.png'
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-amber-500/30 hover:bg-amber-500/10"
                                >
                                  <Download className="w-3.5 h-3.5" /> Download
                                  QR
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="flex gap-3 px-6 py-4 border-t border-border/30">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-11"
              onClick={step === 1 ? handleClose : goPreviousStep}
              disabled={submitting}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step < TOTAL_STEPS ? (
              <Button
                type="button"
                className="flex-1 h-11 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={goNextStep}
                disabled={!canProceed()}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1 h-11 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />{' '}
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Submit Booking
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewImageUrl}
        onOpenChange={(open) => {
          if (!open) setPreviewImageUrl(null);
        }}
      >
        <DialogContent className="sm:max-w-lg bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>{previewImageTitle}</DialogTitle>
          </DialogHeader>
          {previewImageUrl && (
            <img
              src={previewImageUrl}
              alt={previewImageTitle}
              className="w-full max-h-[70vh] object-contain rounded-xl border border-border/40 bg-muted/20"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
