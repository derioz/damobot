import React from "react";
import { cn } from "../../utils/cn";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "success" | "danger" | "warning" | "brand" | "neutral" | "discord";
  className?: string;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "neutral",
  className,
  dot = false,
}) => {
  const variants = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    danger: "bg-rose-500/10 text-rose-400 border-rose-500/25",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    brand: "bg-brand-orangeMuted text-brand-orange border-brand-orangeBorder",
    neutral: "bg-dark-800 text-slate-300 border-dark-700",
    discord: "bg-discord-blurple/15 text-discord-blurple border-discord-blurple/30",
  };

  const dots = {
    success: "bg-emerald-400",
    danger: "bg-rose-400",
    warning: "bg-amber-400",
    brand: "bg-brand-orange",
    neutral: "bg-slate-400",
    discord: "bg-discord-blurple",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
        variants[variant],
        className
      )}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", dots[variant])} />}
      {children}
    </span>
  );
};
