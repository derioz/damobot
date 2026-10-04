import React from "react";
import { cn } from "../../utils/cn";

interface BorderGlowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  glowColor?: string;
}

export const BorderGlow: React.FC<BorderGlowProps> = ({
  children,
  active = false,
  className,
  glowColor = "from-brand-orange/40 via-amber-500/20 to-transparent",
  ...props
}) => {
  return (
    <div className={cn("relative group rounded-xl p-[1px] overflow-hidden", className)} {...props}>
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r transition-all duration-500 rounded-xl",
          active ? glowColor : "from-dark-750 via-dark-700 to-dark-750 group-hover:from-dark-700 group-hover:to-dark-600"
        )}
      />
      <div className="relative rounded-[11px] bg-dark-850 h-full w-full">{children}</div>
    </div>
  );
};
