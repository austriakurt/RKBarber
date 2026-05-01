import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Activity } from "lucide-react";
import { QueueBoard } from "./QueueBoard";
import type { QueueItem, Barber, Booking } from "@/lib/types";

interface QueueModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  queue: QueueItem[];
  todayBookings?: Booking[];
  barbers: Barber[];
  loading?: boolean;
}

export function QueueModal({ open, onOpenChange, queue, todayBookings = [], barbers, loading }: QueueModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl bg-card border-border/50 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5 text-primary" />
            Live Queue Board
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Real-time walk-in queue status and today's reservations for each barber.
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : barbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Activity className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">No barbers available right now</p>
            <p className="text-xs opacity-60">Check back during shop hours.</p>
          </div>
        ) : (
          <div className="pt-2">
            <QueueBoard queue={queue} todayBookings={todayBookings} barbers={barbers} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
