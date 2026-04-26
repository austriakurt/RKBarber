import { motion } from "framer-motion";
import type { QueueItem, Barber } from "@/lib/types";
import { User } from "lucide-react";

interface QueueBoardProps {
  queue: QueueItem[];
  barbers: Barber[];
}

export function QueueBoard({ queue, barbers }: QueueBoardProps) {
  // Group queue by barber
  const queueByBarber = barbers.reduce((acc, barber) => {
    acc[barber.id] = queue.filter(q => q.barberId === barber.id).sort((a, b) => a.position - b.position);
    return acc;
  }, {} as Record<string, QueueItem[]>);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {barbers.map((barber, idx) => (
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
              {queueByBarber[barber.id].length} in queue
            </div>
          </div>
          
          <div className="p-4 flex-1">
            {queueByBarber[barber.id].length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-muted-foreground opacity-70">
                <User className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No walk-ins waiting</p>
              </div>
            ) : (
              <div className="space-y-3">
                {queueByBarber[barber.id].map((item, i) => (
                  <div 
                    key={item.id}
                    className={`flex items-center gap-4 p-3 rounded-xl border ${
                      item.status === 'in-progress' 
                        ? 'border-primary/50 bg-primary/5' 
                        : 'border-border/30 bg-background/50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      item.status === 'in-progress'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{item.customerName}</p>
                      {item.status === 'in-progress' && (
                        <p className="text-xs text-primary font-medium flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                          In Chair
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}