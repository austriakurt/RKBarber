import { motion } from 'framer-motion';
import { Activity, Loader2, Users } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { AmbientPageBackground } from '@/components/layout/AmbientPageBackground';
import { QueueBoard } from '@/components/queue/QueueBoard';
import {
  useBarbers,
  useQueue,
  useTodayBookings,
  useSettings,
} from '@/hooks/useFirestore';
import LogoImg from '@assets/rkbarber-logo-transparent.png';

export default function QueuePage() {
  const { barbers, loading: barbersLoading } = useBarbers();
  const { queue, loading: queueLoading } = useQueue();
  const { bookings: todayBookings, loading: todayLoading } = useTodayBookings();
  const { settings } = useSettings();

  const shopName = settings?.shopName || 'RK Barbershop';
  const activeBarbers = barbers.filter((b) => b.active);
  const loading = queueLoading || barbersLoading || todayLoading;
  const activeQueue = queue.filter((q) => q.status !== 'done');

  return (
    <AmbientPageBackground className="min-h-screen bg-background">
      <Navbar />

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
              <img
                src={LogoImg}
                alt={shopName}
                className="w-8 h-8 object-contain"
              />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Real-time Status
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black font-heading mb-4">
              Live <span className="text-primary">Queue</span> Board
            </h1>
            <p className="text-lg text-muted-foreground">
              Real-time walk-in queue status and today's reservations for each
              barber. Reservations are prioritized at their schedule time.
              Updates automatically.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Live Stats Bar */}
      <section className="border-b border-border/30 bg-card/50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center gap-6 py-4 overflow-x-auto">
            <div className="flex items-center gap-3 shrink-0">
              <div className="relative">
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-emerald-500" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Active Queue
                </p>
                <p className="text-lg font-black text-foreground">
                  {activeQueue.length}
                </p>
              </div>
            </div>
            <div className="w-px h-8 bg-border/50" />
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Active Barbers
                </p>
                <p className="text-lg font-black text-foreground">
                  {activeBarbers.length}
                </p>
              </div>
            </div>
            <div className="w-px h-8 bg-border/50" />
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Today's Reservations
                </p>
                <p className="text-lg font-black text-foreground">
                  {
                    todayBookings.filter(
                      (b) =>
                        b.type === 'reservation' &&
                        (b.status === 'pending' || b.status === 'confirmed')
                    ).length
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Queue Board */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : activeBarbers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <Activity className="w-14 h-14 opacity-30" />
              <p className="text-lg font-medium">
                No barbers available right now
              </p>
              <p className="text-sm opacity-60">
                Check back during shop hours.
              </p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <QueueBoard
                queue={queue}
                todayBookings={todayBookings}
                barbers={activeBarbers}
              />
            </motion.div>
          )}
        </div>
      </section>

      {/* Legend */}
      <section className="pb-16 md:pb-20">
        <div className="container mx-auto px-4 md:px-6">
          <div className="bg-card rounded-2xl border border-border/50 p-6 max-w-2xl mx-auto">
            <h3 className="font-semibold text-sm mb-4 text-muted-foreground uppercase tracking-wider">
              Queue Legend
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
                <span className="text-sm text-muted-foreground">
                  In Chair (being served)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-muted-foreground/50" />
                <span className="text-sm text-muted-foreground">
                  Waiting (walk-in)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-sm text-muted-foreground">
                  Reservation (scheduled)
                </span>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Queue Note: Reservations are prioritized at their scheduled
                time. Walk-ins are still served by arrival order when no
                scheduled reservation is due.
              </p>
              <p className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
                Paalala: Mas inuuna ang may reservation kapag oras na ng
                schedule nila. Ang walk-in ay sunod pa rin base sa pagkakasunod
                ng dating.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-border/30 text-center">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {shopName}. All rights reserved.
        </p>
      </footer>
    </AmbientPageBackground>
  );
}
