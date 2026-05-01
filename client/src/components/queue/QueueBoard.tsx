import { motion } from "framer-motion";
import type { QueueItem, Barber, Booking } from "@/lib/types";
import { User, CalendarClock } from "lucide-react";
import { format } from "date-fns";

interface QueueBoardProps {
  queue: QueueItem[];
  todayBookings?: Booking[];
  barbers: Barber[];
}

export function QueueBoard({ queue, todayBookings = [], barbers }: QueueBoardProps) {
  // Group queue by barber
  const queueByBarber = barbers.reduce((acc, barber) => {
    acc[barber.id] = queue.filter(q => q.barberId === barber.id && q.status !== "done").sort((a, b) => a.position - b.position);
    return acc;
  }, {} as Record<string, QueueItem[]>);

  const bookingsByBarber = barbers.reduce((acc, barber) => {
    acc[barber.id] = todayBookings
      .filter(b => b.barberId === barber.id && b.type === "reservation" && (b.status === "pending" || b.status === "confirmed" || b.status === "completed" && new Date().toDateString() === new Date(b.createdAt).toDateString()))
      // Actually let's just show pending and confirmed reservations.
      .filter(b => b.status === "pending" || b.status === "confirmed")
      .sort((a, b) => {
        // Parse time to sort chronologically
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
    return acc;
  }, {} as Record<string, Booking[]>);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {barbers.map((barber, idx) => {
        const bq = queueByBarber[barber.id];
        const bb = bookingsByBarber[barber.id];
        const totalItems = bq.length + bb.length;

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={barber.id}
            className="bg-card border border-border/50 rounded-2xl overflow-hidden flex flex-col shadow-lg"
          >
            <div className="bg-muted/50 p-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-primary/20 bg-primary/10 flex items-center justify-center">
                  {barber.image ? (
                    <img src={barber.image} alt={barber.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-primary">{barber.name.charAt(0)}</span>
                  )}
                </div>
                <h3 className="font-bold text-lg">{barber.name}</h3>
              </div>
              <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-semibold">
                {totalItems} in queue
              </div>
            </div>
            
            <div className="p-4 flex-1">
              {totalItems === 0 ? (
                <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-muted-foreground opacity-70">
                  <User className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No walk-ins or reservations</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Walk-ins */}
                  {bq.map((item, i) => (
                    <div 
                      key={item.id}
                      className={`flex items-center gap-4 p-3 rounded-xl border ${
                        item.status === 'in-progress' 
                          ? 'border-primary/50 bg-primary/5' 
                          : 'border-border/30 bg-background/50'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        item.status === 'in-progress'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{item.customerName}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Walk-in</span>
                          {item.status === 'in-progress' && (
                            <span className="text-[10px] text-primary font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                              In Chair
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Reservations */}
                  {bb.map((booking) => (
                    <div 
                      key={booking.id}
                      className="flex items-center gap-4 p-3 rounded-xl border border-blue-500/30 bg-blue-500/5"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 bg-blue-500/10 text-blue-500">
                        <CalendarClock className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{booking.customerName}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold text-blue-500 tracking-wider">Reservation</span>
                          <span className="text-[10px] text-blue-500 font-medium bg-blue-500/10 px-1.5 py-0.5 rounded-md">
                            {booking.time}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}