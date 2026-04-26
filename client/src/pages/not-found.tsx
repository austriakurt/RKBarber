import { Link } from "wouter";
import { Scissors, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-0 right-0 w-[50vw] h-[50vw] bg-primary/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[40vw] h-[40vw] bg-secondary/5 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/3 pointer-events-none" />

      <div className="relative z-10 text-center space-y-6 max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
          <Scissors className="w-10 h-10 text-primary" />
        </div>
        <div>
          <p className="text-7xl font-black text-primary font-heading leading-none mb-2">404</p>
          <h1 className="text-2xl font-bold font-heading mb-2">Page Not Found</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Looks like this page got a bad cut. Let's get you back to something fresh.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6 font-semibold gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Home
            </Button>
          </Link>
          <Link href="/barbers">
            <Button variant="outline" className="rounded-full px-6 hover:bg-accent/50">
              View Our Barbers
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
