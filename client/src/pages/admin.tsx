import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  LayoutDashboard, Users, Calendar, Settings,
  ArrowLeft, Loader2, Trash2, UserCheck, UserX,
  X, LogOut, Lock, Activity, CheckCircle, Plus,
  Edit2, Scissors, Clock, Eye, EyeOff, AlertCircle, Upload, Download, Image as ImageIcon, BarChart2, ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AmbientPageBackground } from "@/components/layout/AmbientPageBackground";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  useBarbers, useQueue, useTodayBookings,
  useBookings, useServices, useSettings, useGallery,
} from "@/hooks/useFirestore";
import { removeFromQueue, updateQueueItem } from "@/lib/firestore";
import { uploadImageFile } from "@/lib/storageUpload";
import {
  adminUpdateBarber,
  adminCreateBarber,
  adminDeleteBarber,
  adminUpdateBookingStatus,
  adminRescheduleBooking,
  adminDeleteBooking,
  adminUpdateQueueItem,
  adminRemoveFromQueue,
  adminCallNextInQueue,
  adminCreateService,
  adminUpdateService,
  adminDeleteService,
  adminUpdateSettings,
  adminCreateGalleryItem,
  adminDeleteGalleryItem,
  adminUpdateGalleryItem,
} from "@/lib/adminApi";
import { useToast } from "@/hooks/use-toast";
import type { Barber, Service, Booking } from "@/lib/types";
import { DAYS_OF_WEEK, getBarberSpecialty } from "@/lib/types";
import { cn } from "@/lib/utils";
import { downloadImageInApp } from "@/lib/fileDownload";
import jsQR from "jsqr";
import LogoImg from "@assets/rkbarber-logo-transparent.png";

const DEFAULT_RESERVATION_POLICY_TEXT = `After scheduling an appointment, kindly wait for confirmation.

Down Payment Required
To secure your slot, a down payment is required as a reservation fee.
NON-REFUNDABLE

No reservation fee = No confirmed booking

Booking Updates
Booking approval, cancellation, and rescheduling are handled by admin. Once approved, a completion email is sent to the client. Admin can force complete only after the waiting window if the client does not confirm.`;

function resolveGcashName(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return "";
  return String(
    settings.gcashName ||
    settings.gcashAccountName ||
    settings.gcashOwnerName ||
    settings.gcashDisplayName ||
    ""
  ).trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to read image"));
    };

    image.src = objectUrl;
  });
}

async function autoCropGcashQrFile(file: File): Promise<{ file: File; cropped: boolean }> {
  const image = await loadImageFromFile(file);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;

  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return { file, cropped: false };

  sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const qr = jsQR(imageData.data, sourceCanvas.width, sourceCanvas.height, {
    inversionAttempts: "attemptBoth",
  });

  if (!qr?.location) return { file, cropped: false };

  const points = [
    qr.location.topLeftCorner,
    qr.location.topRightCorner,
    qr.location.bottomLeftCorner,
    qr.location.bottomRightCorner,
  ];

  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const qrSize = Math.max(maxX - minX, maxY - minY);

  // Keep the crop focused on the QR itself.
  const sidePadding = qrSize * 0.24;
  const topPadding = qrSize * 0.24;
  const bottomPadding = qrSize * 0.24;

  const cropX = Math.floor(clamp(minX - sidePadding, 0, sourceCanvas.width - 1));
  const cropY = Math.floor(clamp(minY - topPadding, 0, sourceCanvas.height - 1));
  const cropRight = Math.ceil(clamp(maxX + sidePadding, 1, sourceCanvas.width));
  const cropBottom = Math.ceil(clamp(maxY + bottomPadding, 1, sourceCanvas.height));
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = cropWidth;
  outCanvas.height = cropHeight;

  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return { file, cropped: false };

  outCtx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    outCanvas.toBlob((result) => resolve(result), "image/png", 0.95);
  });

  if (!blob) return { file, cropped: false };

  const baseName = (file.name || "gcash-qr").replace(/\.[^.]+$/, "");
  const croppedFile = new File([blob], `${baseName}-cropped.png`, { type: "image/png" });
  return { file: croppedFile, cropped: true };
}

// ─────────────────────────────────────────────────────────
// Generic delete confirmation dialog
// ─────────────────────────────────────────────────────────
function DeleteDialog({
  open, onOpenChange, title, description, onConfirm, loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// Service dialog (add / edit)
// ─────────────────────────────────────────────────────────
function ServiceDialog({
  open, onOpenChange, service, onSaved, availableServices, setIsProcessing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  service: Service | null;
  onSaved: () => void;
  availableServices: Service[];
  setIsProcessing: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [walkinPrice, setWalkinPrice] = useState("");
  const [reservationPrice, setReservationPrice] = useState("");
  const [serviceType, setServiceType] = useState<"solo" | "package">("solo");
  const [includedServiceIds, setIncludedServiceIds] = useState<string[]>([]);
  const [noPrice, setNoPrice] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const isEdit = !!service;

  // Reset form whenever dialog opens (fixes stale pre-fill)
  useEffect(() => {
    if (open) {
      setName(service?.name || "");
      setDescription(service?.description || "");
      const walkin = Number(service?.walkinPrice ?? service?.price ?? 0);
      const reservation = Number(service?.reservationPrice ?? service?.price ?? 0);
      const serviceHasNoPrice = Boolean(service?.noPrice) || (walkin <= 0 && reservation <= 0);
      setNoPrice(serviceHasNoPrice);
      setServiceType(service?.serviceType === "package" ? "package" : "solo");
      setIncludedServiceIds(Array.isArray(service?.includedServiceIds) ? service.includedServiceIds : []);
      setWalkinPrice(serviceHasNoPrice ? "" : String(walkin || ""));
      setReservationPrice(serviceHasNoPrice ? "" : String(reservation || ""));
    }
  }, [open, service]);

  const handleSave = async () => {
    if (!name || (!noPrice && (!walkinPrice || !reservationPrice))) return;
    if (serviceType === "package" && includedServiceIds.length === 0) {
      toast({ title: "Choose at least one solo service for a package", variant: "destructive" });
      return;
    }
    setIsProcessing(true);
    setSaving(true);
    try {
      const walkin = noPrice ? 0 : Number(walkinPrice);
      const reservation = noPrice ? 0 : Number(reservationPrice);
      const data = {
        name, description,
        serviceType,
        includedServiceIds: serviceType === "package" ? includedServiceIds : [],
        price: walkin,
        walkinPrice: walkin,
        reservationPrice: reservation,
        noPrice,
        duration: service?.duration ?? 30,
        active: service?.active ?? true,
        order: service?.order ?? Date.now(),
        createdAt: service?.createdAt || new Date().toISOString(),
      };
      if (isEdit && service) {
        await adminUpdateService(service.id, data);
      } else {
        await adminCreateService(data);
      }
      toast({ title: isEdit ? "Service updated ✓" : "Service created ✓" });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: "Error saving service", variant: "destructive" });
    } finally {
      setSaving(false);
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border/50">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Service" : "Add Service"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this service details." : "Create a new service offering."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Service Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Haircut" className="bg-input/50" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." className="bg-input/50" />
          </div>
          <div className="space-y-1.5">
            <Label>Service Category</Label>
            <div className="inline-flex rounded-xl border border-border/50 bg-muted/20 p-1">
              <button
                type="button"
                className={cn("px-3 py-1.5 text-xs rounded-lg font-semibold", serviceType === "solo" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                onClick={() => {
                  setServiceType("solo");
                  setIncludedServiceIds([]);
                }}
              >
                Solo
              </button>
              <button
                type="button"
                className={cn("px-3 py-1.5 text-xs rounded-lg font-semibold", serviceType === "package" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                onClick={() => setServiceType("package")}
              >
                Package
              </button>
            </div>
          </div>
          {serviceType === "package" && (
            <div className="space-y-1.5">
              <Label>Included Solo Services</Label>
              <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto p-2 bg-muted/20 rounded-xl border border-border/30">
                {availableServices
                  .filter((svc) => (svc.serviceType || "solo") === "solo" && (!service || svc.id !== service.id))
                  .map((svc) => {
                    const checked = includedServiceIds.includes(svc.id);
                    return (
                      <label key={svc.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setIncludedServiceIds((prev) =>
                              checked ? prev.filter((id) => id !== svc.id) : [...prev, svc.id]
                            );
                          }}
                          className="w-3.5 h-3.5 accent-primary"
                        />
                        <span className="text-xs truncate">{svc.name}</span>
                      </label>
                    );
                  })}
              </div>
              <p className="text-xs text-muted-foreground">Friendly package labels are auto-updated from selected solo service names.</p>
            </div>
          )}
          <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Service Pricing{noPrice ? "" : " *"}</Label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={noPrice}
                    onCheckedChange={(checked) => {
                      const isNoPrice = checked === true;
                      setNoPrice(isNoPrice);
                      if (isNoPrice) {
                        setWalkinPrice("");
                        setReservationPrice("");
                      }
                    }}
                  />
                  No price
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Walk-in (₱)</Label>
                  <Input
                    type="number"
                    value={walkinPrice}
                    onChange={(e) => setWalkinPrice(e.target.value)}
                    placeholder={noPrice ? "Hidden" : "200"}
                    className="bg-input/50"
                    disabled={noPrice}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Reservation (₱)</Label>
                  <Input
                    type="number"
                    value={reservationPrice}
                    onChange={(e) => setReservationPrice(e.target.value)}
                    placeholder={noPrice ? "Hidden" : "300"}
                    className="bg-input/50"
                    disabled={noPrice}
                  />
                </div>
              </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleSave}
            disabled={saving || !name || (!noPrice && (!walkinPrice || !reservationPrice))}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {isEdit ? "Save Changes" : "Create Service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// Time conversion helpers for barber availability inputs
// ─────────────────────────────────────────────────────────
function to24Hour(time12: string): string {
  if (!time12) return "09:00";
  const parts = time12.trim().split(" ");
  if (parts.length < 2) return "09:00";
  const [timePart, period] = parts;
  const colonParts = timePart.split(":");
  let h = parseInt(colonParts[0], 10);
  const m = parseInt(colonParts[1] || "0", 10);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function to12Hour(time24: string): string {
  if (!time24) return "9:00 AM";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

// ─────────────────────────────────────────────────────────
// Barber dialog (add / edit) — services multi-select, pre-fill fixed
// ─────────────────────────────────────────────────────────
function BarberDialog({
  open, onOpenChange, barber, onSaved, availableServices, setIsProcessing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  barber: Barber | null;
  onSaved: () => void;
  availableServices: Service[];
  setIsProcessing: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [reservePrice, setReservePrice] = useState("");
  const [walkinPrice, setWalkinPrice] = useState("");
  const [image, setImage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [availableFrom, setAvailableFrom] = useState("9:00 AM");
  const [availableTo, setAvailableTo] = useState("8:00 PM");
  const [availableDays, setAvailableDays] = useState<string[]>([...DAYS_OF_WEEK]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [newDayOff, setNewDayOff] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const isEdit = !!barber;

  // Reset all fields whenever dialog opens — fixes stale pre-fill
  useEffect(() => {
    if (open) {
      setName(barber?.name || "");
      setSelectedServices(barber?.services || []);
      setReservePrice(String(barber?.reservePrice || ""));
      setWalkinPrice(String(barber?.walkinPrice || ""));
      setImage(barber?.image || "");
      setImageFile(null);
      setAvailableFrom(barber?.availableFrom || "9:00 AM");
      setAvailableTo(barber?.availableTo || "8:00 PM");
      setAvailableDays(barber?.availableDays || [...DAYS_OF_WEEK]);
      setDaysOff(barber?.daysOff || []);
      setNewDayOff("");
    }
  }, [open, barber]);

  const toggleService = (id: string) =>
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSave = async () => {
    if (!name) return;
    setIsProcessing(true);
    setSaving(true);
    try {
      let finalImageUrl = image;
      if (imageFile) {
        finalImageUrl = await uploadImageFile({
          file: imageFile,
          folder: "barbers",
          prefix: name.toLowerCase().replace(/\s+/g, "-"),
          onCompress: () => toast({ title: `Image compressed`, description: "The image was larger than 3MB and was automatically optimized for faster loading." })
        });
      }
      // derive specialty string from chosen service names for display
      const specialty = availableServices
        .filter((s) => selectedServices.includes(s.id))
        .map((s) => s.name)
        .join(", ");
      const data = {
        name, specialty,
        services: selectedServices,
        reservePrice: Number(reservePrice),
        walkinPrice: Number(walkinPrice),
        image: finalImageUrl,
        active: barber?.active ?? true,
        order: barber?.order ?? Date.now(),
        availableDays, availableFrom, availableTo,
        daysOff,
        createdAt: barber?.createdAt || new Date().toISOString(),
      };
      if (isEdit && barber) {
        await adminUpdateBarber(barber.id, data);
      } else {
        await adminCreateBarber(data);
      }
      toast({ title: isEdit ? "Barber updated ✓" : "Barber added ✓" });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: "Error saving barber", variant: "destructive" });
    } finally {
      setSaving(false);
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border/50 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Barber" : "Add Barber"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update barber profile and availability." : "Add a new barber profile and schedule."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Barber name" className="bg-input/50" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Reserve Price (₱)</Label>
              <Input type="number" value={reservePrice} onChange={(e) => setReservePrice(e.target.value)} placeholder="200" className="bg-input/50" />
            </div>
            <div className="space-y-1.5">
              <Label>Walk-in Price (₱)</Label>
              <Input type="number" value={walkinPrice} onChange={(e) => setWalkinPrice(e.target.value)} placeholder="120" className="bg-input/50" />
            </div>
          </div>

          {/* Services multi-checkbox */}
          <div className="space-y-2">
            <Label>Services Offered</Label>
            {availableServices.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-1">No services yet — add services first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 bg-muted/20 rounded-xl border border-border/30">
                {availableServices.map((svc) => (
                  <label key={svc.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(svc.id)}
                      onChange={() => toggleService(svc.id)}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium truncate">{svc.name}</span>
                      {!svc.noPrice && (
                        <span className="text-xs text-muted-foreground">
                          W ₱{Number(svc.walkinPrice ?? svc.price ?? 0)} / R ₱{Number(svc.reservationPrice ?? svc.price ?? 0)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Profile Image</Label>
            {(image || imageFile) && (
              <div className="mb-2">
                <img src={imageFile ? URL.createObjectURL(imageFile) : image} alt="Barber preview" className="w-16 h-16 rounded-full object-cover border-2 border-border/50" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer">
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors text-sm text-muted-foreground">
                  <Upload className="w-4 h-4" />
                  <span>{image || imageFile ? "Change Image" : "Upload Image"}</span>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setImageFile(file);
                  }}
                />
              </label>
              {(image || imageFile) && (
                <Button type="button" variant="ghost" size="sm" className="h-10 text-red-500 hover:bg-red-500/10" onClick={() => { setImage(""); setImageFile(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Available From</Label>
              <Input
                type="time"
                value={to24Hour(availableFrom)}
                onChange={(e) => setAvailableFrom(to12Hour(e.target.value))}
                className="bg-input/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Available To</Label>
              <Input
                type="time"
                value={to24Hour(availableTo)}
                onChange={(e) => setAvailableTo(to12Hour(e.target.value))}
                className="bg-input/50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Available Days</Label>
            <div className="flex flex-wrap gap-2">
              {[...DAYS_OF_WEEK].map((day) => (
                <button
                  key={day} type="button"
                  onClick={() => setAvailableDays((prev) =>
                    prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                  )}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                    availableDays.includes(day)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border/50 text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Days Off */}
          <div className="space-y-2">
            <Label>Days Off <span className="text-xs text-muted-foreground font-normal">(specific dates blocked)</span></Label>
            <div className="flex gap-2">
              <input
                type="date"
                value={newDayOff}
                onChange={(e) => setNewDayOff(e.target.value)}
                min={format(new Date(), "yyyy-MM-dd")}
                className="flex-1 rounded-xl border border-border/50 bg-input/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => {
                  if (newDayOff && !daysOff.includes(newDayOff)) {
                    setDaysOff((prev) => [...prev, newDayOff].sort());
                    setNewDayOff("");
                  }
                }}
                disabled={!newDayOff}
              >
                Add
              </Button>
            </div>
            {daysOff.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {daysOff.map((d) => (
                  <span key={d} className="flex items-center gap-1 text-xs bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2 py-1 rounded-full">
                    {d}
                    <button type="button" onClick={() => setDaysOff((prev) => prev.filter((x) => x !== d))} className="hover:text-red-500 ml-0.5 font-bold">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSave} disabled={saving || !name}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {isEdit ? "Save Changes" : "Add Barber"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// Booking Details Dialog
// ─────────────────────────────────────────────────────────
function BookingDetailsDialog({
  booking, displayPrice, onOpenChange, onStatusChange, onReschedule, onDelete,
}: {
  booking: Booking | null;
  displayPrice: number;
  onOpenChange: (v: boolean) => void;
  onStatusChange: (id: string, status: "confirmed" | "cancelled" | "completed") => void;
  onReschedule: (booking: Booking) => void;
  onDelete: (b: Booking) => void;
}) {
  const { toast } = useToast();
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  if (!booking) return null;

  const handleDownloadProof = async () => {
    if (!booking.paymentProofUrl) return;
    try {
      await downloadImageInApp(booking.paymentProofUrl, `payment-proof-${booking.id}.png`);
    } catch {
      toast({ title: "Failed to download payment proof", variant: "destructive" });
    }
  };

  const statusConfig: Record<string, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    pending:   { label: "Pending",   className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    completed: { label: "Completed", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    cancelled: { label: "Cancelled", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const decisionConfig: Record<string, string> = {
    awaiting: "Awaiting admin review",
    accepted: "Admin confirmed",
    cancelled: "Cancelled",
    reschedule_requested: "Rescheduled",
    expired: "Expired",
  };
  const deadlineRaw = String(booking.customerActionDeadline || "").trim();
  const deadlineMs = deadlineRaw ? Date.parse(deadlineRaw) : Number.NaN;
  const canForceComplete = booking.type === "reservation"
    && booking.status === "confirmed"
    && booking.customerActionRequired === true
    && Number.isFinite(deadlineMs)
    && Date.now() >= deadlineMs;
  const waitingForClientCompletion = booking.type === "reservation"
    && booking.status === "confirmed"
    && booking.customerActionRequired === true
    && !canForceComplete;
  const canMarkCompleted = booking.status === "confirmed"
    && (booking.type === "walkin" || booking.customerActionRequired !== true || canForceComplete);
  const sc = statusConfig[booking.status] || statusConfig.pending;
  const initials = booking.customerName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <>
    <Dialog open={!!booking} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-full sm:max-w-md max-h-[92vh] bg-card border-border/50 shadow-2xl p-0 overflow-hidden flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>Booking details for {booking.customerName}</DialogTitle>
          <DialogDescription>Review booking details and take booking actions.</DialogDescription>
        </DialogHeader>
        {/* Header gradient strip */}
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />

        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-5 sm:pb-6 space-y-5 overflow-y-auto">
          {/* Customer hero */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="text-xl font-black text-primary">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold truncate">{booking.customerName}</h2>
              <p className="text-sm text-muted-foreground">{booking.phone}</p>
              {booking.email && <p className="text-xs text-muted-foreground truncate">{booking.email}</p>}
            </div>
            <span className={cn("text-xs font-semibold px-3 py-1 rounded-full border shrink-0", sc.className)}>
              {sc.label}
            </span>
          </div>

          {/* Key stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/30 border border-border/40 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Type</p>
              <p className="text-sm font-semibold capitalize">{booking.type}</p>
            </div>
            <div className="bg-muted/30 border border-border/40 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Barber</p>
              <p className="text-sm font-semibold truncate">{booking.barberName}</p>
            </div>
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total</p>
              <p className="text-sm font-black text-primary">₱{displayPrice}</p>
            </div>
          </div>

          {/* Detail rows */}
          <div className="bg-muted/20 border border-border/30 rounded-2xl divide-y divide-border/20 overflow-hidden">
            {[
              { label: "Service(s)", value: booking.serviceName || "—" },
              {
                label: "Payment Proof",
                value: booking.paymentProofUrl
                  ? "uploaded"
                  : booking.type === "reservation"
                    ? "not uploaded"
                    : "not required",
              },
              {
                label: "Confirmation",
                value: booking.type === "reservation"
                  ? (decisionConfig[booking.customerDecision || "awaiting"] || (booking.customerDecision || "awaiting"))
                  : "not required",
              },
              ...(booking.type === "reservation" && booking.status === "confirmed"
                ? [{
                    label: "Client Completion",
                    value: waitingForClientCompletion
                      ? `Waiting for client action${Number.isFinite(deadlineMs) ? ` (force complete after ${new Date(deadlineMs).toLocaleString()})` : ""}`
                      : canForceComplete
                        ? "Force complete available"
                        : "Completion unlocked",
                  }]
                : []),
              ...(booking.date ? [{ label: "Date & Time", value: `${booking.date}${booking.time ? ` · ${booking.time}` : ""}` }] : []),
              { label: "Booking ID", value: `#${booking.id.slice(-6).toUpperCase()}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between px-4 py-2.5 text-sm">
                <span className="text-muted-foreground shrink-0 mr-4">{label}</span>
                <span className="font-medium text-right break-words max-w-[65%]">{value}</span>
              </div>
            ))}
            {booking.notes && (
              <div className="px-4 py-2.5 text-sm">
                <span className="text-muted-foreground block mb-1.5">Notes</span>
                <div
                  className="bg-muted/30 border border-border/30 rounded-xl px-3 py-2 max-h-28 overflow-y-auto overflow-x-hidden text-xs leading-relaxed"
                  style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
                >
                  {booking.notes}
                </div>
              </div>
            )}
            {booking.paymentProofUrl && (
              <div className="px-4 py-2.5 text-sm border-t border-border/20 space-y-2">
                <span className="text-muted-foreground block">Payment Proof</span>
                <img
                  src={booking.paymentProofUrl}
                  alt="Customer payment proof"
                  className="w-full max-h-56 object-contain rounded-lg border border-border/30 bg-background"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewImageUrl(booking.paymentProofUrl || null)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> View Proof
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadProof()}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {booking.status === "pending" && (
              <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white h-9 text-xs gap-1.5 flex-1" onClick={() => { onStatusChange(booking.id, "confirmed"); onOpenChange(false); }}>
                <CheckCircle className="w-3.5 h-3.5" /> Confirm
              </Button>
            )}
            {(booking.status === "pending" || booking.status === "confirmed") && (
              <Button size="sm" variant="outline" className="text-primary border-primary/40 hover:bg-primary/10 h-9 text-xs gap-1.5 flex-1" onClick={() => { onReschedule(booking); onOpenChange(false); }}>
                <Calendar className="w-3.5 h-3.5" /> Reschedule
              </Button>
            )}
            {canMarkCompleted && (
              <Button size="sm" className="bg-blue-500 hover:bg-blue-600 text-white h-9 text-xs gap-1.5 flex-1" onClick={() => { onStatusChange(booking.id, "completed"); onOpenChange(false); }}>
                <UserCheck className="w-3.5 h-3.5" /> {canForceComplete ? "Force Complete" : "Complete"}
              </Button>
            )}
            {booking.status !== "cancelled" && booking.status !== "completed" && (
              <Button size="sm" variant="outline" className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 h-9 text-xs gap-1.5 flex-1" onClick={() => { onStatusChange(booking.id, "cancelled"); onOpenChange(false); }}>
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 h-9 text-xs gap-1.5" onClick={() => { onDelete(booking); onOpenChange(false); }}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!previewImageUrl} onOpenChange={(open) => { if (!open) setPreviewImageUrl(null); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-full sm:max-w-lg max-h-[92vh] bg-card border-border/50 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Proof Preview</DialogTitle>
          <DialogDescription>Preview uploaded payment proof without leaving the admin panel.</DialogDescription>
        </DialogHeader>
        {previewImageUrl && (
          <img
            src={previewImageUrl}
            alt="Payment proof preview"
            className="w-full max-h-[70vh] object-contain rounded-xl border border-border/40 bg-muted/20"
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Login page — split layout
// ─────────────────────────────────────────────────────────
function AdminLogin() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left: branded panel ── */}
      <div className="hidden lg:flex w-1/2 relative bg-background flex-col items-center justify-center px-12 overflow-hidden border-r border-border/30">
        <div className="absolute top-0 right-0 w-[40vw] h-[40vw] bg-primary/8 rounded-full blur-[100px] -translate-y-1/2" />
        <div className="absolute bottom-0 left-0 w-[30vw] h-[30vw] bg-secondary/8 rounded-full blur-[80px] translate-y-1/3" />
        <div className="relative z-10 text-center space-y-6">
          <img
            src={LogoImg}
            alt="RK Barbershop"
            className="w-48 h-48 object-contain mx-auto drop-shadow-[0_0_50px_rgba(242,183,5,0.3)]"
          />
          <div>
            <h1 className="text-4xl font-black font-heading mb-2 tracking-tight">RK BARBERSHOP</h1>
            <p className="text-primary font-semibold tracking-widest text-sm uppercase">Clean Cuts. Professional Barbers.</p>
          </div>
          <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
            Premium grooming services since 2018. Manage bookings, barbers and services from this panel.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <div className="px-5 py-3 bg-card border border-border/50 rounded-2xl text-center">
              <p className="text-2xl font-bold text-primary">6+</p>
              <p className="text-xs text-muted-foreground">Barbers</p>
            </div>
            <div className="px-5 py-3 bg-card border border-border/50 rounded-2xl text-center">
              <p className="text-2xl font-bold text-primary">2018</p>
              <p className="text-xs text-muted-foreground">Est.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div className="flex-1 flex flex-col bg-card">
        <div className="p-5">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1.5 h-8">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
            </Button>
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center px-8 pb-16">
          <div className="w-full max-w-sm">
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-8">
              <img src={LogoImg} alt="RK Barbershop" className="w-16 h-16 object-contain mx-auto mb-3" />
              <p className="font-heading font-bold">RK BARBERSHOP</p>
            </div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold font-heading">Welcome back</h2>
              <p className="text-muted-foreground mt-1 text-sm">Sign in to your admin account</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" required className="bg-background border-border/50 h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="bg-background border-border/50 h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary border-border"
                />
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer text-muted-foreground">Remember me</Label>
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-500">{error}</p>
                </div>
              )}
              <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-11 font-semibold" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Sign In
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main Admin Dashboard
// ─────────────────────────────────────────────────────────
export default function Admin() {
  const { user, loading: authLoading, isAdmin, signOut, changePassword } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { barbers, loading: barbersLoading } = useBarbers();
  const { queue, loading: queueLoading } = useQueue();
  const { bookings: todayBookings, loading: todayLoading } = useTodayBookings();
  const { bookings: allBookings, loading: allBookingsLoading, error: allBookingsError } = useBookings();
  const { services, loading: servicesLoading } = useServices();
  const { settings } = useSettings();
  const { gallery: galleryItems } = useGallery();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  // Settings form state
  const [shopName, setShopName] = useState("");
  const [tagline, setTagline] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [country, setCountry] = useState("");
  const [operatingDays, setOperatingDays] = useState("");
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [email, setEmail] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [gcashNumber, setGcashNumber] = useState("");
  const [gcashName, setGcashName] = useState("");
  const [gcashQrCodeUrl, setGcashQrCodeUrl] = useState("");
  const [gcashQrUploading, setGcashQrUploading] = useState(false);
  const gcashQrInputRef = useRef<HTMLInputElement | null>(null);
  const [gcashQrPreviewOpen, setGcashQrPreviewOpen] = useState(false);
  const [reservationPolicyText, setReservationPolicyText] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [confirmPasswordChangeOpen, setConfirmPasswordChangeOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Sync settings form when data loads
  useEffect(() => {
    if (settings) {
      setShopName(settings.shopName || "");
      setTagline(settings.tagline || "");
      setAboutText(settings.aboutText || "");
      setAddress(settings.address || "");
      setCity(settings.city || "");
      setProvince(settings.province || "");
      setCountry(settings.country || "");
      setOperatingDays(settings.operatingDays || "");
      setOpenTime(settings.openTime || "");
      setCloseTime(settings.closeTime || "");
      setEmail(settings.email || "");
      setFacebookUrl(settings.facebookUrl || "");
      setTiktokUrl(settings.tiktokUrl || "");
      setGoogleMapsUrl(settings.googleMapsUrl || "");
      setGcashNumber(settings.gcashNumber || "");
      setGcashName(resolveGcashName(settings as unknown as Record<string, unknown>));
      setGcashQrCodeUrl(settings.gcashQrCodeUrl || "");
      setReservationPolicyText(String(settings.reservationPolicyText || "").trim() || DEFAULT_RESERVATION_POLICY_TEXT);
    }
  }, [settings]);

  const handleGcashQrUpload = async (file: File) => {
    setGcashQrUploading(true);
    try {
      const processed = await autoCropGcashQrFile(file);
      if (!processed.cropped) {
        toast({ title: "Uploaded image kept as-is (QR auto-crop not detected)." });
      }

      const uploaded = await uploadImageFile({
        file: processed.file,
        folder: "gcash",
        prefix: "shop-qr",
        onCompress: () => toast({ title: `Compressed QR code`, description: "File exceeded 3MB and was automatically compressed." })
      });
      setGcashQrCodeUrl(uploaded);
      const normalizedGcashName = gcashName.trim();
      try {
        await adminUpdateSettings({
          gcashQrCodeUrl: uploaded,
          gcashNumber: gcashNumber.trim(),
          gcashName: normalizedGcashName,
          gcashAccountName: normalizedGcashName,
          gcashOwnerName: normalizedGcashName,
          gcashDisplayName: normalizedGcashName,
        });
        toast({ title: "GCash QR uploaded and saved ✓" });
      } catch {
        toast({ title: "QR uploaded but failed to auto-save. Click Save Settings.", variant: "destructive" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload GCash QR";
      toast({ title: message, variant: "destructive" });
    } finally {
      setGcashQrUploading(false);
    }
  };

  const handleDownloadGcashQr = async () => {
    if (!gcashQrCodeUrl) return;
    try {
      await downloadImageInApp(gcashQrCodeUrl, "rkbarbershop-gcash-qr.png");
      toast({ title: "GCash QR downloaded" });
    } catch {
      toast({ title: "Failed to download QR", variant: "destructive" });
    }
  };

  // Dialog states
  const [editBarber, setEditBarber] = useState<Barber | null | "new">(null);
  const [editService, setEditService] = useState<Service | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "barber" | "service" | "booking"; id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [viewBooking, setViewBooking] = useState<Booking | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  // Booking filters
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterBarber, setFilterBarber] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <AdminLogin />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-border/50 bg-card p-6 text-center">
          <h1 className="text-xl font-bold font-heading mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground mb-5">
            This account does not have admin permissions for RK Barbershop.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Link href="/">
              <Button variant="outline">Back to Home</Button>
            </Link>
            <Button variant="destructive" onClick={signOut}>Sign Out</Button>
          </div>
        </div>
      </div>
    );
  }

  const todayReservations = todayBookings.filter((b) => b.type === "reservation");
  const todayWalkins = todayBookings.filter((b) => b.type === "walkin");
  const activeQueue = queue.filter((q) => q.status !== "done");
  const activeBarbers = barbers.filter((b) => b.active);
  const getBookingDisplayPrice = (booking: Booking): number => {
    if (Number(booking.price) > 0) return Number(booking.price);
    const barber = barbers.find((b) => b.id === booking.barberId);
    if (!barber) return Number(booking.price) || 0;
    return booking.type === "reservation" ? barber.reservePrice : barber.walkinPrice;
  };
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const upcomingBookings = allBookings
    .filter((b) => b.date >= todayStr && b.status !== "cancelled" && b.status !== "completed")
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));

  const stats = [
    { title: "Today's Reservations", value: todayReservations.length, icon: Calendar, sub: "Booked today", tab: "bookings" },
    { title: "Walk-ins Today", value: todayWalkins.length, icon: Users, sub: "Walk-in queue", tab: "queue" },
    { title: "Active Queue", value: activeQueue.length, icon: Activity, sub: "In queue now", tab: "queue" },
    { title: "Available Barbers", value: activeBarbers.length, icon: CheckCircle, sub: `${barbers.length - activeBarbers.length} inactive`, tab: "barbers" },
  ];

  const handleToggleBarber = async (id: string, active: boolean) => {
    await adminUpdateBarber(id, { active: !active });
    toast({ title: `Barber ${!active ? "enabled" : "disabled"}` });
  };

  const handleBookingStatus = async (id: string, status: "confirmed" | "cancelled" | "completed") => {
    setIsProcessing(true);
    try {
      await adminUpdateBookingStatus(id, status);
      toast({ title: `Booking marked as ${status}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update booking status";
      toast({ title: message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAllPending = async () => {
    const pending = allBookings.filter((b) => b.status === "pending");
    if (pending.length === 0) return;
    await Promise.all(pending.map((b) => adminUpdateBookingStatus(b.id, "confirmed")));
    toast({ title: `${pending.length} booking${pending.length > 1 ? "s" : ""} confirmed` });
  };

  const handleQueueNext = async (barberId: string) => {
    const bq = activeQueue.filter((q) => q.barberId === barberId).sort((a, b) => a.position - b.position);
    const inProgress = bq.find((q) => q.status === "in-progress");
    const next = bq.find((q) => q.status === "waiting");

    // Direct Firestore writes for instant UI update via onSnapshot
    if (inProgress) await removeFromQueue(inProgress.id);
    if (next) await updateQueueItem(next.id, { status: "in-progress" });

    toast({ title: next ? `${next.customerName} is now in chair` : "Queue advanced" });

    // Fire-and-forget: call server to send email notifications (don't await)
    adminCallNextInQueue(barberId).then((result) => {
      if (result.emailSent) {
        toast({ title: `Queue notification email sent` });
      }
    }).catch(() => { /* email failed silently */ });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsProcessing(true);
    setDeleteLoading(true);
    try {
      if (deleteTarget.type === "barber") await adminDeleteBarber(deleteTarget.id);
      else if (deleteTarget.type === "service") await adminDeleteService(deleteTarget.id);
      else if (deleteTarget.type === "booking") await adminDeleteBooking(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setIsProcessing(false);
    }
  };

  const openRescheduleDialog = (booking: Booking) => {
    setRescheduleTarget(booking);
    setRescheduleDate(booking.date || format(new Date(), "yyyy-MM-dd"));
    setRescheduleTime(booking.time ? to24Hour(booking.time) : "09:00");
  };

  const handleRescheduleBooking = async () => {
    if (!rescheduleTarget || !rescheduleDate || !rescheduleTime) return;
    setRescheduleSaving(true);
    try {
      await adminRescheduleBooking(rescheduleTarget.id, {
        date: rescheduleDate,
        time: to12Hour(rescheduleTime),
      });
      toast({ title: "Booking rescheduled" });
      setRescheduleTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reschedule booking";
      toast({ title: message, variant: "destructive" });
    } finally {
      setRescheduleSaving(false);
    }
  };

  const resetChangePasswordForm = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setShowOldPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordError("");
  };

  const validateChangePassword = () => {
    if (!oldPassword || !newPassword || !confirmNewPassword) {
      setPasswordError("Please fill out all password fields.");
      return false;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return false;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords do not match.");
      return false;
    }
    if (oldPassword === newPassword) {
      setPasswordError("New password must be different from old password.");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const handleChangePassword = async () => {
    setPasswordSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      toast({ title: "Password updated ✓" });
      setConfirmPasswordChangeOpen(false);
      setChangePasswordOpen(false);
      resetChangePasswordForm();
    } catch (err: any) {
      const code = err?.code || "";
      if (code.includes("wrong-password") || code.includes("invalid-credential")) {
        setPasswordError("Old password is incorrect.");
      } else if (code.includes("too-many-requests")) {
        setPasswordError("Too many attempts. Please try again later.");
      } else {
        setPasswordError("Failed to change password. Please try again.");
      }
      setConfirmPasswordChangeOpen(false);
    } finally {
      setPasswordSaving(false);
    }
  };

  const TABS = [
    { key: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { key: "services",  icon: Scissors,       label: "Services" },
    { key: "barbers",   icon: Users,           label: "Barbers" },
    { key: "bookings",  icon: Calendar,        label: "Bookings" },
    { key: "queue",     icon: Activity,        label: "Queue" },
    { key: "reports",   icon: BarChart2,       label: "Reports" },
    { key: "gallery",   icon: ImagePlus,       label: "Gallery" },
  ];

  return (
    <AmbientPageBackground className="h-screen bg-background" contentClassName="h-full overflow-hidden flex flex-col md:flex-row">
      {/* Dialogs */}
      {deleteTarget && (
        <DeleteDialog
          open={!!deleteTarget}
          onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
          title={`Delete ${deleteTarget.name}?`}
          description="This action cannot be undone."
          onConfirm={handleDelete}
          loading={deleteLoading}
        />
      )}

      <BookingDetailsDialog
        booking={viewBooking}
        displayPrice={viewBooking ? getBookingDisplayPrice(viewBooking) : 0}
        onOpenChange={(v) => { if (!v) setViewBooking(null); }}
        onStatusChange={handleBookingStatus}
        onReschedule={openRescheduleDialog}
        onDelete={(b) => setDeleteTarget({ type: "booking", id: b.id, name: `${b.customerName}'s booking` })}
      />

      <Dialog open={gcashQrPreviewOpen} onOpenChange={setGcashQrPreviewOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>GCash QR Preview</DialogTitle>
            <DialogDescription>Preview the shop QR code without leaving the admin panel.</DialogDescription>
          </DialogHeader>
          {gcashQrCodeUrl && (
            <img
              src={gcashQrCodeUrl}
              alt="GCash QR preview"
              className="w-full max-h-[70vh] object-contain rounded-xl border border-border/40 bg-muted/20"
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setGcashQrPreviewOpen(false)}>Close</Button>
            <Button type="button" onClick={() => void handleDownloadGcashQr()}>
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rescheduleTarget} onOpenChange={(v) => { if (!v) setRescheduleTarget(null); }}>
        <DialogContent className="sm:max-w-sm bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Reschedule Booking</DialogTitle>
            <DialogDescription>
              {rescheduleTarget ? `${rescheduleTarget.customerName} with ${rescheduleTarget.barberName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="bg-input/50" />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} className="bg-input/50" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRescheduleTarget(null)} disabled={rescheduleSaving}>Cancel</Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleRescheduleBooking} disabled={rescheduleSaving || !rescheduleDate || !rescheduleTime}>
              {rescheduleSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServiceDialog
        open={editService !== null}
        onOpenChange={(v) => { if (!v) setEditService(null); }}
        service={editService === "new" ? null : editService}
        onSaved={() => setEditService(null)}
        availableServices={services}
        setIsProcessing={setIsProcessing}
      />

      <BarberDialog
        open={editBarber !== null}
        onOpenChange={(v) => { if (!v) setEditBarber(null); }}
        barber={editBarber === "new" ? null : editBarber}
        onSaved={() => setEditBarber(null)}
        availableServices={services}
        setIsProcessing={setIsProcessing}
      />

      <Dialog
        open={changePasswordOpen}
        onOpenChange={(open) => {
          setChangePasswordOpen(open);
          if (!open) {
            setConfirmPasswordChangeOpen(false);
            resetChangePasswordForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Change Admin Password</DialogTitle>
            <DialogDescription>Update your admin account password securely.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">Signed in as {user?.email || "admin"}</p>

            <div className="space-y-1.5">
              <Label htmlFor="old-password">Old Password</Label>
              <div className="relative">
                <Input
                  id="old-password"
                  type={showOldPassword ? "text" : "password"}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="bg-input/50 border-border/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showOldPassword ? "Hide old password" : "Show old password"}
                >
                  {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="bg-input/50 border-border/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirm-new-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="bg-input/50 border-border/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-500">{passwordError}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setChangePasswordOpen(false);
                setConfirmPasswordChangeOpen(false);
                resetChangePasswordForm();
              }}
              disabled={passwordSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                if (validateChangePassword()) setConfirmPasswordChangeOpen(true);
              }}
              disabled={passwordSaving}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmPasswordChangeOpen} onOpenChange={setConfirmPasswordChangeOpen}>
        <DialogContent className="sm:max-w-sm bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Confirm Password Change</DialogTitle>
            <DialogDescription>Confirm you want to apply the new admin password.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to change the admin password now?</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmPasswordChangeOpen(false)} disabled={passwordSaving}>
              Back
            </Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleChangePassword} disabled={passwordSaving}>
              {passwordSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating…</> : "Confirm Change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-64 bg-card border-r border-border/50 flex-shrink-0 flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            <span className="font-heading font-bold tracking-tight">RK Admin</span>
          </Link>
        </div>
        <div className="p-4 space-y-1 flex-1">
          {TABS.map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start font-medium transition-all duration-150",
                activeTab === tab.key
                  ? ""
                  : "hover:bg-accent hover:text-foreground hover:translate-x-0.5"
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              <tab.icon className="mr-2 h-4 w-4" /> {tab.label}
            </Button>
          ))}
        </div>
        <div className="p-4 border-t border-border/50 space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-150"
            onClick={() => setActiveTab("settings")}
          >
            <Settings className="mr-2 h-4 w-4" /> Settings
          </Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-all duration-150" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-card border-b border-border/50 flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
          <div className="md:hidden flex items-center gap-2">
            <Link href="/"><Button variant="ghost" size="icon" className="w-8 h-8"><ArrowLeft className="w-4 h-4" /></Button></Link>
            <span className="font-heading font-bold text-sm">RK Admin</span>
          </div>

          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <div className="md:hidden flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                onClick={() => setActiveTab("settings")}
                aria-label="Open settings"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-red-400 hover:text-red-400 hover:bg-red-500/10"
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
            <div className="hidden md:flex w-8 h-8 rounded-full bg-primary/20 items-center justify-center border border-primary/30">
              <span className="text-xs font-bold text-primary">AD</span>
            </div>
          </div>
        </header>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/50 flex items-center justify-around">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-col items-center gap-0.5 px-2 py-3 flex-1 transition-colors ${activeTab === tab.key ? "text-primary" : "text-muted-foreground"}`}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6 bg-muted/10">

          {/* ── Dashboard ─────────────────────────────────── */}
          {activeTab === "dashboard" && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div>
                <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
                <p className="text-muted-foreground text-sm">Overview for today.</p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveTab(s.tab)}
                    className="bg-card p-5 rounded-2xl border border-border/50 shadow-sm text-left hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-2 bg-primary/10 rounded-lg"><s.icon className="w-5 h-5 text-primary" /></div>
                      <span className="text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">{s.sub}</span>
                    </div>
                    <h3 className="text-3xl font-bold mb-1">{s.value}</h3>
                    <p className="text-xs text-muted-foreground">{s.title}</p>
                  </button>
                ))}
              </div>
              <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <div className="p-5 border-b border-border/50 flex justify-between items-center">
                  <div>
                    <h2 className="font-semibold">Upcoming Bookings</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Pending &amp; confirmed</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab("bookings")}>View All</Button>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border/50">
                        <TableHead>Customer</TableHead><TableHead>Barber</TableHead>
                        <TableHead>Service</TableHead><TableHead>Date</TableHead>
                        <TableHead>Type</TableHead><TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allBookingsLoading ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                      ) : upcomingBookings.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No upcoming bookings</TableCell></TableRow>
                      ) : upcomingBookings.slice(0, 8).map((b) => (
                        <TableRow key={b.id} className="border-border/50 text-sm hover:bg-accent/20 cursor-pointer" onClick={() => setViewBooking(b)}>
                          <TableCell className="font-medium">{b.customerName}</TableCell>
                          <TableCell>{b.barberName}</TableCell>
                          <TableCell>{b.serviceName || "—"}</TableCell>
                          <TableCell>{b.date}{b.time ? ` ${b.time}` : ""}</TableCell>
                          <TableCell><Badge variant={b.type === "reservation" ? "default" : "secondary"} className="text-xs">{b.type}</Badge></TableCell>
                          <TableCell>
                            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", {
                              "bg-emerald-500/10 text-emerald-500": b.status === "confirmed",
                              "bg-amber-500/10 text-amber-500": b.status === "pending",
                              "bg-blue-500/10 text-blue-500": b.status === "completed",
                              "bg-red-500/10 text-red-500": b.status === "cancelled",
                            })}>{b.status}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* ── Services ──────────────────────────────────── */}
          {activeTab === "services" && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold mb-1">Services</h1>
                  <p className="text-muted-foreground text-sm">Manage Solo and Package services with live, friendly labels.</p>
                </div>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setEditService("new")}>
                  <Plus className="w-4 h-4 mr-2" /> Add Service
                </Button>
              </div>
              {servicesLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-6">
                  {["solo", "package"].map((group) => {
                    const groupedServices = services.filter((s) => {
                      const isPackage = s.serviceType === "package" || (Array.isArray(s.includedServiceIds) && s.includedServiceIds.length > 0);
                      return group === "package" ? isPackage : !isPackage;
                    });
                    return (
                      <div key={group} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            {group === "solo" ? "Solo" : "Package"}
                          </h2>
                          <span className="text-xs text-muted-foreground">{groupedServices.length} item{groupedServices.length !== 1 ? "s" : ""}</span>
                        </div>
                        {groupedServices.length === 0 ? (
                          <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                            No {group} services yet.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {groupedServices.map((s) => {
                              const includedNames = (s.includedServiceIds || [])
                                .map((serviceId) => services.find((item) => item.id === serviceId)?.name || "")
                                .filter(Boolean)
                                .join(" + ");
                              return (
                                <ContextMenu key={s.id}>
                      <ContextMenuTrigger asChild>
                                  <div className={cn("bg-card rounded-xl border p-3 shadow-sm transition-all hover:border-border hover:shadow-md cursor-default select-none", s.active ? "border-border/50" : "border-border/30 opacity-60")}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{s.name}</p>
                                        {s.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{s.description}</p>}
                                        {group === "package" && includedNames && (
                                          <p className="text-[11px] text-primary/80 mt-1">{includedNames}</p>
                                        )}
                                      </div>
                                      <div className="flex gap-1 shrink-0">
                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-accent" onClick={() => setEditService(s)}>
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-red-500/10 text-red-500"
                                          onClick={() => setDeleteTarget({ type: "service", id: s.id, name: s.name })}>
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                      {!s.noPrice ? (
                                        <span className="font-bold text-primary text-xs">W ₱{Number(s.walkinPrice ?? s.price ?? 0)} / R ₱{Number(s.reservationPrice ?? s.price ?? 0)}</span>
                                      ) : <span className="text-xs text-muted-foreground">No price</span>}
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await adminUpdateService(s.id, { active: !s.active });
                                          toast({ title: s.active ? "Service hidden" : "Service visible" });
                                        }}
                                        className={cn("text-[11px] px-2 py-0.5 rounded-full border transition-all hover:opacity-80",
                                          s.active ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10" : "border-border/50 text-muted-foreground"
                                        )}
                                      >
                                        {s.active ? "Active" : "Hidden"}
                                      </button>
                                    </div>
                                  </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem onClick={() => setEditService(s)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit Service
                        </ContextMenuItem>
                        <ContextMenuItem onClick={async () => {
                          await adminUpdateService(s.id, { active: !s.active });
                          toast({ title: s.active ? "Service hidden" : "Service visible" });
                        }}>
                          {s.active ? "Hide Service" : "Show Service"}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                          onClick={() => setDeleteTarget({ type: "service", id: s.id, name: s.name })}>
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Barbers ───────────────────────────────────── */}
          {activeTab === "barbers" && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold mb-1">Barbers</h1>
                  <p className="text-muted-foreground text-sm">Manage barbers, availability, and pricing. Right-click for shortcuts.</p>
                </div>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setEditBarber("new")}>
                  <Plus className="w-4 h-4 mr-2" /> Add Barber
                </Button>
              </div>
              {barbersLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {barbers.map((b) => (
                    <ContextMenu key={b.id}>
                      <ContextMenuTrigger asChild>
                        <div className={cn("bg-card rounded-2xl border shadow-sm overflow-hidden transition-all hover:border-border hover:shadow-md cursor-default select-none", b.active ? "border-border/50" : "border-border/30 opacity-60")}>
                          <div className="p-5">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center overflow-hidden">
                                  {b.image ? <img src={b.image} alt={b.name} className="w-full h-full object-cover" /> : <span className="text-lg font-bold text-primary">{b.name.charAt(0)}</span>}
                                </div>
                                <div>
                                  <h3 className="font-bold">{b.name}</h3>
                                  {getBarberSpecialty(b, services) && <p className="text-xs text-muted-foreground truncate max-w-[140px]">{getBarberSpecialty(b, services)}</p>}
                                  <Badge variant={b.active ? "default" : "secondary"} className="text-xs mt-1">{b.active ? "Active" : "Inactive"}</Badge>
                                </div>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-accent" onClick={() => setEditBarber(b)}>
                                  <Edit2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-red-500/10 text-red-500"
                                  onClick={() => setDeleteTarget({ type: "barber", id: b.id, name: b.name })}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-1.5 mb-4 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-primary" />
                                {b.availableFrom || "9:00 AM"} – {b.availableTo || "8:00 PM"}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(b.availableDays || DAYS_OF_WEEK).map((d) => (
                                  <span key={d} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs">{d.slice(0, 3)}</span>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-muted/30 p-2 rounded-lg text-center border border-border/30">
                                <p className="text-muted-foreground mb-0.5">Reserve</p>
                                <p className="font-bold">₱{b.reservePrice}</p>
                              </div>
                              <div className="bg-muted/30 p-2 rounded-lg text-center border border-border/30">
                                <p className="text-muted-foreground mb-0.5">Walk-in</p>
                                <p className="font-bold">₱{b.walkinPrice}</p>
                              </div>
                            </div>
                            {b.daysOff && b.daysOff.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-border/30">
                                <p className="text-xs text-muted-foreground mb-1.5">Days Off</p>
                                <div className="flex flex-wrap gap-1">
                                  {b.daysOff.map((d) => (
                                    <span key={d} className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full">{d}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem onClick={() => setEditBarber(b)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit Barber
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleToggleBarber(b.id, b.active)}>
                          {b.active ? <><UserX className="w-4 h-4 mr-2" /> Disable</> : <><UserCheck className="w-4 h-4 mr-2" /> Enable</>}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                          onClick={() => setDeleteTarget({ type: "barber", id: b.id, name: b.name })}>
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Bookings ──────────────────────────────────── */}
          {activeTab === "bookings" && (() => {
            const filteredBookings = allBookings.filter((b) => {
              if (filterStatus !== "all" && b.status !== filterStatus) return false;
              if (filterBarber !== "all" && b.barberId !== filterBarber) return false;
              if (filterType !== "all" && b.type !== filterType) return false;
              return true;
            });
            const reservationCount = allBookings.filter((b) => b.type === "reservation").length;
            const walkinCount = allBookings.filter((b) => b.type === "walkin").length;
            return (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-bold mb-1">All Bookings</h1>
                  <p className="text-muted-foreground text-sm">Manage all reservations and walk-ins. Right-click a row for shortcuts.</p>
                </div>
                {allBookings.some((b) => b.status === "pending") && (
                  <button
                    type="button"
                    onClick={handleConfirmAllPending}
                    className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all font-medium"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Confirm All Pending
                  </button>
                )}
              </div>
              {/* Filters */}
              <div className="bg-card/70 border border-border/50 rounded-2xl p-4 md:p-5 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booking Type</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "all", label: "All", count: allBookings.length },
                        { key: "reservation", label: "Reservations", count: reservationCount },
                        { key: "walkin", label: "Walk-ins", count: walkinCount },
                      ].map((typeOption) => (
                        <button
                          key={typeOption.key}
                          type="button"
                          onClick={() => setFilterType(typeOption.key)}
                          className={cn(
                            "h-9 px-3.5 rounded-full border text-xs font-medium transition-all",
                            filterType === typeOption.key
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-accent/40"
                          )}
                        >
                          {typeOption.label} ({typeOption.count})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                    <div className="flex flex-wrap gap-2">
                      {["all", "pending", "confirmed", "completed", "cancelled"].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setFilterStatus(s)}
                          className={cn(
                            "h-9 px-3.5 rounded-full border text-xs font-medium transition-all capitalize",
                            filterStatus === s
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-accent/40"
                          )}
                        >
                          {s === "all" ? "All" : s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="w-full sm:w-56 space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Barber</label>
                    <select
                      value={filterBarber}
                      onChange={(e) => setFilterBarber(e.target.value)}
                      className="w-full h-9 rounded-xl border border-border/60 bg-background/80 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="all">All Barbers</option>
                      {barbers.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {(filterStatus !== "all" || filterBarber !== "all" || filterType !== "all") && (
                  <button
                    type="button"
                    onClick={() => { setFilterStatus("all"); setFilterBarber("all"); setFilterType("all"); }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4"
                  >
                    Clear filters
                  </button>
                )}
              </div>
              {allBookingsError && (
                <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-500">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Failed to load bookings: {allBookingsError}
                </div>
              )}
              <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border/50">
                        <TableHead>Customer</TableHead><TableHead>Barber</TableHead>
                        <TableHead>Service</TableHead><TableHead>Date</TableHead>
                        <TableHead>Type</TableHead><TableHead>Price</TableHead>
                        <TableHead>Proof</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allBookingsLoading ? (
                        <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                      ) : filteredBookings.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">{allBookings.length === 0 ? "No bookings yet" : "No bookings match the current filters"}</TableCell></TableRow>
                      ) : filteredBookings.map((b) => (
                        <ContextMenu key={b.id}>
                          <ContextMenuTrigger asChild>
                            <TableRow className="border-border/50 text-sm hover:bg-accent/30 cursor-default">
                              <TableCell className="font-medium">{b.customerName}</TableCell>
                              <TableCell>{b.barberName}</TableCell>
                              <TableCell>{(b as any).serviceName || "—"}</TableCell>
                              <TableCell>{b.date}{b.time ? ` ${b.time}` : ""}</TableCell>
                              <TableCell><Badge variant={b.type === "reservation" ? "default" : "secondary"} className="text-xs">{b.type}</Badge></TableCell>
                              <TableCell className="font-semibold">₱{getBookingDisplayPrice(b)}</TableCell>
                              <TableCell>
                                {b.paymentProofUrl ? (
                                  <button
                                    type="button"
                                    className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                                    onClick={() => setViewBooking(b)}
                                  >
                                    Uploaded
                                  </button>
                                ) : (
                                  <span className="text-[11px] px-2 py-1 rounded-full border border-border/50 text-muted-foreground">
                                    None
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", {
                                  "bg-emerald-500/10 text-emerald-500": b.status === "confirmed",
                                  "bg-amber-500/10 text-amber-500": b.status === "pending",
                                  "bg-blue-500/10 text-blue-500": b.status === "completed",
                                  "bg-red-500/10 text-red-500": b.status === "cancelled",
                                })}>{b.status}</span>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-accent" title="View Details" onClick={() => setViewBooking(b)}>
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-red-500 h-7 w-7 p-0 hover:bg-red-500/10" title="Delete"
                                    onClick={() => setDeleteTarget({ type: "booking", id: b.id, name: `${b.customerName}'s booking` })}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-48">
                            <ContextMenuItem onClick={() => setViewBooking(b)}><Eye className="w-4 h-4 mr-2" /> View Details</ContextMenuItem>
                            {b.status === "pending" && <ContextMenuItem className="text-emerald-500 focus:text-emerald-500" onClick={() => handleBookingStatus(b.id, "confirmed")}><CheckCircle className="w-4 h-4 mr-2" /> Confirm</ContextMenuItem>}
                            {(b.status === "pending" || b.status === "confirmed") && <ContextMenuItem className="text-primary focus:text-primary" onClick={() => openRescheduleDialog(b)}><Calendar className="w-4 h-4 mr-2" /> Reschedule</ContextMenuItem>}
                            {(b.status === "confirmed" && (b.type === "walkin" || b.customerActionRequired !== true || (b.customerActionRequired === true && String(b.customerActionDeadline || "").trim() && Date.now() >= Date.parse(String(b.customerActionDeadline))))) && <ContextMenuItem className="text-blue-500 focus:text-blue-500" onClick={() => handleBookingStatus(b.id, "completed")}><UserCheck className="w-4 h-4 mr-2" /> {b.type === "reservation" && b.customerActionRequired === true ? "Force Complete" : "Mark Complete"}</ContextMenuItem>}
                            {b.status !== "cancelled" && b.status !== "completed" && <ContextMenuItem className="text-amber-500 focus:text-amber-500" onClick={() => handleBookingStatus(b.id, "cancelled")}><X className="w-4 h-4 mr-2" /> Cancel</ContextMenuItem>}
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-red-500 focus:text-red-500 focus:bg-red-500/10" onClick={() => setDeleteTarget({ type: "booking", id: b.id, name: `${b.customerName}'s booking` })}><Trash2 className="w-4 h-4 mr-2" /> Delete</ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
            );
          })()}

          {/* ── Queue ─────────────────────────────────────── */}
          {activeTab === "queue" && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div>
                <h1 className="text-2xl font-bold mb-1">Live Queue</h1>
                <p className="text-muted-foreground text-sm">Manage walk-in customers in real time. Right-click queue items for shortcuts.</p>
              </div>
              {queueLoading || barbersLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {barbers.filter((b) => b.active).map((barber) => {
                    const bq = activeQueue.filter((q) => q.barberId === barber.id).sort((a, c) => a.position - c.position);
                    const bb = todayBookings
                      .filter(b => b.barberId === barber.id && b.type === "reservation" && (b.status === "pending" || b.status === "confirmed"))
                      .sort((a, b) => {
                        const parseTimeStr = (tStr: string) => {
                          if (!tStr) return 0;
                          const match = tStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
                          if (!match) return 0;
                          let h = parseInt(match[1], 10);
                          const m = parseInt(match[2], 10);
                          const period = match[3]?.toUpperCase();
                          if (period === "PM" && h !== 12) h += 12;
                          if (period === "AM" && h === 12) h = 0;
                          return (h || 0) * 60 + (m || 0);
                        };
                        return parseTimeStr(a.time) - parseTimeStr(b.time);
                      });
                    const totalItems = bq.length + bb.length;

                    return (
                      <div key={barber.id} className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                        <div className="p-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/20">
                              <span className="text-sm font-bold text-primary">{barber.name.charAt(0)}</span>
                            </div>
                            <h3 className="font-bold text-sm">{barber.name}</h3>
                          </div>
                          <Badge variant="outline" className="text-xs">{totalItems} in queue</Badge>
                        </div>
                        <div className="p-4 space-y-2 min-h-[80px]">
                          {totalItems === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">No customers or reservations</p>
                          ) : (
                            <>
                              {/* Walk-ins */}
                              {bq.map((item) => (
                                <ContextMenu key={item.id}>
                                  <ContextMenuTrigger asChild>
                                    <div className={cn("flex items-center justify-between p-2.5 rounded-xl border text-sm transition-colors hover:bg-accent/20 cursor-default", item.status === "in-progress" ? "border-primary/50 bg-primary/5" : "border-border/30 bg-background/50")}>
                                      <div className="flex items-center gap-2.5">
                                        <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold", item.status === "in-progress" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                                          {item.position}
                                        </span>
                                        <div>
                                          <p className="font-medium text-xs">{item.customerName}</p>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Walk-in</span>
                                            {item.status === "in-progress" && <p className="text-[10px] text-primary flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> In Chair</p>}
                                          </div>
                                        </div>
                                      </div>
                                      <Button size="sm" variant="ghost" className="text-red-500 h-7 w-7 p-0 hover:bg-red-500/10" onClick={() => adminRemoveFromQueue(item.id).then(() => toast({ title: "Removed from queue" }))}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent className="w-44">
                                    <ContextMenuItem onClick={() => handleQueueNext(barber.id)}>
                                      Call Next in Line
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                                      onClick={() => adminRemoveFromQueue(item.id).then(() => toast({ title: "Removed from queue" }))}>
                                      <Trash2 className="w-4 h-4 mr-2" /> Remove
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                              ))}

                              {/* Reservations */}
                              {bb.map((booking) => (
                                <div 
                                  key={booking.id}
                                  className="flex items-center justify-between p-2.5 rounded-xl border text-sm transition-colors cursor-default border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500/10 text-blue-500">
                                      <Calendar className="w-3.5 h-3.5" />
                                    </span>
                                    <div>
                                      <p className="font-medium text-xs">{booking.customerName}</p>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] uppercase font-bold text-blue-500 tracking-wider">Reservation</span>
                                        <span className="text-[10px] text-blue-500 font-medium bg-blue-500/10 px-1.5 py-0.5 rounded-md">
                                          {booking.time}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <Button size="sm" variant="ghost" className="text-blue-500 h-7 w-7 p-0 hover:bg-blue-500/20" title="View Details" onClick={() => { setActiveTab("dashboard"); setTimeout(() => setViewBooking(booking), 100); }}>
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                        <div className="p-4 pt-0">
                          <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => handleQueueNext(barber.id)} disabled={bq.length === 0}>
                            Call Next
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Reports ─────────────────────────────────────── */}
          {activeTab === "reports" && (() => {
            const reportDate = new Date();
            const reportDateStr = format(reportDate, "yyyy-MM-dd");
            const todaysBookings = allBookings.filter((b) => (b.date || "") === reportDateStr);
            const completedToday = todaysBookings.filter((b) => b.status === "completed");
            const confirmedToday = todaysBookings.filter((b) => b.status === "confirmed");
            const pendingToday = todaysBookings.filter((b) => b.status === "pending");
            const reservationsToday = todaysBookings.filter((b) => b.type === "reservation");
            const walkinsToday = todaysBookings.filter((b) => b.type === "walkin");

            return (
              <div className="space-y-4 max-w-5xl mx-auto">
                <div>
                  <h1 className="text-xl font-bold">Daily Report</h1>
                  <p className="text-muted-foreground text-xs">{format(reportDate, "MMMM d, yyyy")}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Total", value: todaysBookings.length, color: "text-primary", bg: "bg-primary/5 border-primary/20" },
                    { label: "Completed", value: completedToday.length, color: "text-green-500", bg: "bg-green-500/5 border-green-500/20" },
                    { label: "Reservations", value: reservationsToday.length, color: "text-blue-500", bg: "bg-blue-500/5 border-blue-500/20" },
                    { label: "Walk-ins", value: walkinsToday.length, color: "text-amber-500", bg: "bg-amber-500/5 border-amber-500/20" },
                  ].map((c) => (
                    <div key={c.label} className={`rounded-xl border p-3 ${c.bg}`}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{c.label}</p>
                      <p className={`text-2xl font-black leading-tight ${c.color}`}>{c.value}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20">
                    <h2 className="text-sm font-bold">Per-Barber Breakdown</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/30 bg-muted/10">
                          <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Barber</th>
                          <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Served</th>
                          <th className="text-center px-2 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Completed</th>
                          <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Reserve</th>
                          <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Walk-in</th>
                          <th className="text-center px-2 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Pending</th>
                        </tr>
                      </thead>
                      <tbody>
                        {barbers.filter((b) => b.active).map((barber) => {
                          const bb = todaysBookings.filter((b) => b.barberId === barber.id);
                          const comp = bb.filter((b) => b.status === "completed").length;
                          const conf = bb.filter((b) => b.status === "confirmed").length;
                          const pend = bb.filter((b) => b.status === "pending").length;
                          return (
                            <tr key={barber.id} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  {barber.image ? (
                                    <img src={barber.image} alt="" className="w-6 h-6 rounded-full object-cover border border-border/30" />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{barber.name.charAt(0)}</div>
                                  )}
                                  <span className="font-semibold truncate">{barber.name}</span>
                                </div>
                              </td>
                              <td className="text-center px-2 py-2 font-bold text-primary">{comp + conf}</td>
                              <td className="text-center px-2 py-2 text-green-500 hidden sm:table-cell">{comp}</td>
                              <td className="text-center px-2 py-2">{bb.filter((b) => b.type === "reservation").length}</td>
                              <td className="text-center px-2 py-2">{bb.filter((b) => b.type === "walkin").length}</td>
                              <td className="text-center px-2 py-2 text-amber-500 hidden sm:table-cell">{pend}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Pending", value: pendingToday.length, cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
                    { label: "Confirmed", value: confirmedToday.length, cls: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
                    { label: "Completed", value: completedToday.length, cls: "bg-green-500/10 text-green-500 border-green-500/20" },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-xl border p-3 text-center ${s.cls}`}>
                      <p className="text-2xl font-black">{s.value}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Gallery ──────────────────────────────────────── */}
          {activeTab === "gallery" && (() => {
            return (
              <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold mb-1">Gallery</h1>
                    <p className="text-muted-foreground text-sm">Upload hairstyle photos that will appear on the front page carousel.</p>
                  </div>
                  <label className="cursor-pointer">
                    <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" asChild>
                      <span><Plus className="w-4 h-4 mr-2" /> Add Photos</span>
                    </Button>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        let uploaded = 0;
                        for (const file of files) {
                          try {
                            const url = await uploadImageFile({ 
                              file, 
                              folder: "gallery", 
                              prefix: "hairstyle",
                              onCompress: () => toast({ title: `Compressed ${file.name}`, description: "File exceeded 3MB and was automatically compressed." })
                            });
                            await adminCreateGalleryItem({
                              imageUrl: url,
                              caption: "",
                              order: Date.now() + uploaded,
                              createdAt: new Date().toISOString(),
                            });
                            uploaded++;
                          } catch (err) {
                            const errMsg = err instanceof Error ? err.message : "Unknown error";
                            toast({ title: `Failed: ${file.name}`, description: errMsg, variant: "destructive" });
                          }
                        }
                        if (uploaded > 0) toast({ title: `${uploaded} photo${uploaded > 1 ? "s" : ""} added to gallery` });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {galleryItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50">
                    <ImageIcon className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">No gallery photos yet. Upload some hairstyle photos!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {galleryItems.map((item) => {
                      const bName = barbers.find((b) => b.id === item.barberId)?.name || "";
                      return (
                        <div key={item.id} className="group relative bg-card rounded-xl border border-border/50 overflow-hidden aspect-square">
                          <img src={item.imageUrl} alt={item.hairstyleName || "Gallery"} className="w-full h-full object-cover" />
                          {/* Bottom info */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-3 py-2.5">
                            <p className="text-xs text-white font-semibold truncate">{item.hairstyleName || "No hairstyle set"}</p>
                            {bName && <p className="text-[10px] text-white/70 truncate">by {bName}</p>}
                          </div>
                          {/* Hover edit overlay */}
                          <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2 p-3">
                            <select
                              className="w-full text-xs bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-white backdrop-blur-sm"
                              value={item.barberId || ""}
                              onChange={async (e) => {
                                try { await adminUpdateGalleryItem(item.id, { barberId: e.target.value }); } catch { toast({ title: "Update failed", variant: "destructive" }); }
                              }}
                            >
                              <option value="" className="text-black">Select barber...</option>
                              {barbers.filter((b) => b.active).map((b) => (
                                <option key={b.id} value={b.id} className="text-black">{b.name}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              placeholder="Hairstyle name..."
                              className="w-full text-xs bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-white placeholder:text-white/40 backdrop-blur-sm"
                              defaultValue={item.hairstyleName || ""}
                              onBlur={async (e) => {
                                const v = e.target.value.trim();
                                if (v !== (item.hairstyleName || "")) {
                                  try { await adminUpdateGalleryItem(item.id, { hairstyleName: v }); } catch { toast({ title: "Update failed", variant: "destructive" }); }
                                }
                              }}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                            <Button size="sm" variant="destructive" className="w-full rounded-lg text-xs h-7" onClick={async () => {
                              try { await adminDeleteGalleryItem(item.id); toast({ title: "Removed" }); } catch { toast({ title: "Failed", variant: "destructive" }); }
                            }}>
                              <Trash2 className="w-3 h-3 mr-1" /> Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Settings ──────────────────────────────────── */}
          {activeTab === "settings" && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div>
                <h1 className="text-2xl font-bold mb-1">Settings</h1>
                <p className="text-muted-foreground text-sm">Configure booking policies and payment details.</p>
              </div>

              {/* Shop Content */}
              <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50">
                  <h2 className="font-semibold">Shop Content</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">These fields are shown on public pages.</p>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Shop Name</Label>
                      <Input value={shopName} onChange={(e) => setShopName(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tagline</Label>
                      <Input value={tagline} onChange={(e) => setTagline(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>About Text</Label>
                    <textarea
                      value={aboutText}
                      onChange={(e) => setAboutText(e.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-border/50 bg-input/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Address</Label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <Input value={city} onChange={(e) => setCity(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Province</Label>
                      <Input value={province} onChange={(e) => setProvince(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Country</Label>
                      <Input value={country} onChange={(e) => setCountry(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Operating Days</Label>
                      <Input value={operatingDays} onChange={(e) => setOperatingDays(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Open Time</Label>
                      <Input value={openTime} onChange={(e) => setOpenTime(e.target.value)} placeholder="e.g. 9:00 AM" className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Close Time</Label>
                      <Input value={closeTime} onChange={(e) => setCloseTime(e.target.value)} placeholder="e.g. 5:00 PM" className="bg-input/50 border-border/50" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Email</Label>
                      <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Facebook URL</Label>
                      <Input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>TikTok URL</Label>
                      <Input value={tiktokUrl} onChange={(e) => setTiktokUrl(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Google Maps URL</Label>
                      <Input value={googleMapsUrl} onChange={(e) => setGoogleMapsUrl(e.target.value)} className="bg-input/50 border-border/50" />
                    </div>
                  </div>
                </div>
              </div>

              {/* GCash / Payment */}
              <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50">
                  <h2 className="font-semibold">Payment Settings</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">GCash number shown to customers on Step 5 &amp; Step 7.</p>
                </div>
                <div className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label>GCash Number</Label>
                    <Input
                      value={gcashNumber}
                      onChange={(e) => setGcashNumber(e.target.value)}
                      placeholder="e.g. 09263746324"
                      className="bg-input/50 border-border/50 max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">Displayed as: "Send ₱[total] via GCash [number]"</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>GCash Name</Label>
                    <Input
                      value={gcashName}
                      onChange={(e) => setGcashName(e.target.value)}
                      placeholder="e.g. JO***** E. L."
                      className="bg-input/50 border-border/50 max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">Displayed to customers under the GCash number in booking steps.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>GCash QR Code</Label>
                    <input
                      ref={gcashQrInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const selected = e.target.files?.[0];
                        if (selected) void handleGcashQrUpload(selected);
                      }}
                      disabled={gcashQrUploading}
                      className="hidden"
                    />
                    {(!gcashQrCodeUrl || gcashQrUploading) && (
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-center border-border/60"
                          onClick={() => gcashQrInputRef.current?.click()}
                          disabled={gcashQrUploading}
                        >
                          {gcashQrUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                          {gcashQrUploading ? "Uploading..." : "Choose QR Image"}
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">PNG, JPG, or WebP. Max 3MB.</p>
                      </div>
                    )}
                    {gcashQrCodeUrl ? (
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                        <img
                          src={gcashQrCodeUrl}
                          alt="GCash QR code"
                          className="w-full max-h-64 object-contain rounded-lg border border-border/30 bg-background"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setGcashQrPreviewOpen(true)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                          >
                            <ImageIcon className="w-3.5 h-3.5" /> View QR
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownloadGcashQr()}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                          >
                            <Download className="w-3.5 h-3.5" /> Download
                          </button>
                          <button
                            type="button"
                            onClick={() => setGcashQrCodeUrl("")}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent"
                          >
                            <Upload className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Upload a QR screenshot/image so clients can scan or download it in reservation steps.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Booking Policy */}
              <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50">
                  <h2 className="font-semibold">Reservation Policy Text</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Shown in Step 5 (Booking Policy) for reservations. Leave blank to use the default policy.</p>
                </div>
                <div className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Policy Content</Label>
                    <textarea
                      value={reservationPolicyText}
                      onChange={(e) => setReservationPolicyText(e.target.value)}
                      placeholder="Edit the default policy text as needed."
                      rows={6}
                      className="w-full rounded-xl border border-border/50 bg-input/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground">Preloaded with the default policy so you can make minor edits quickly.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto h-11"
                  disabled={settingsSaving}
                  onClick={async () => {
                    setIsProcessing(true);
                    setSettingsSaving(true);
                    try {
                      const normalizedGcashName = gcashName.trim();
                      await adminUpdateSettings({
                        shopName,
                        tagline,
                        aboutText,
                        address,
                        city,
                        province,
                        country,
                        operatingDays,
                        openTime,
                        closeTime,
                        email,
                        facebookUrl,
                        tiktokUrl,
                        googleMapsUrl,
                        gcashNumber: gcashNumber.trim(),
                        gcashName: normalizedGcashName,
                        gcashAccountName: normalizedGcashName,
                        gcashOwnerName: normalizedGcashName,
                        gcashDisplayName: normalizedGcashName,
                        gcashQrCodeUrl,
                        reservationPolicyText,
                      });
                      toast({ title: "Settings saved ✓" });
                    } catch {
                      toast({ title: "Failed to save settings", variant: "destructive" });
                    } finally {
                      setSettingsSaving(false);
                      setIsProcessing(false);
                    }
                  }}
                >
                  {settingsSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save Settings"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto h-11 border-border/60 transition-colors hover:bg-primary hover:text-primary-foreground"
                  onClick={() => {
                    setPasswordError("");
                    setConfirmPasswordChangeOpen(false);
                    setChangePasswordOpen(true);
                  }}
                >
                  <Lock className="w-4 h-4 mr-2" /> Change Password
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Processing Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="bg-card border border-border/50 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-200">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              <Loader2 className="w-6 h-6 text-primary animate-pulse absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="font-heading font-bold text-lg tracking-wide">Processing...</p>
            <p className="text-xs text-muted-foreground">Please wait a moment</p>
          </div>
        </div>
      )}
    </AmbientPageBackground>
  );
}
