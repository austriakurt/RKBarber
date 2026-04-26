import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AmbientPageBackgroundProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  topGlowClassName?: string;
  bottomGlowClassName?: string;
};

export function AmbientPageBackground({
  children,
  className,
  contentClassName,
  topGlowClassName,
  bottomGlowClassName,
}: AmbientPageBackgroundProps) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute top-0 right-0 w-[50vw] h-[50vw] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none",
          topGlowClassName,
        )}
      />
      <div
        className={cn(
          "absolute bottom-0 left-0 w-[40vw] h-[40vw] bg-secondary/5 rounded-full blur-[80px] translate-y-1/3 -translate-x-1/3 pointer-events-none",
          bottomGlowClassName,
        )}
      />

      <div className={cn("relative z-10", contentClassName)}>{children}</div>
    </div>
  );
}
