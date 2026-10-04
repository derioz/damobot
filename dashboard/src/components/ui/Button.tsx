import React from "react";
import { cn } from "../../utils/cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "discord";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  disabled,
  ...props
}) => {
  const base =
    "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-dark-950 disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]";

  const sizes = {
    sm: "text-xs px-2.5 py-1.5 gap-1.5",
    md: "text-sm px-4 py-2 gap-2",
    lg: "text-base px-5 py-2.5 gap-2.5",
  };

  const variants = {
    primary:
      "bg-brand-orange text-dark-950 font-semibold hover:bg-brand-orangeHover focus:ring-brand-orange shadow-md shadow-brand-orange/20",
    secondary:
      "bg-dark-800 text-slate-200 border border-dark-700 hover:bg-dark-750 hover:border-dark-600 focus:ring-slate-500",
    danger:
      "bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 focus:ring-rose-500",
    ghost:
      "text-slate-400 hover:text-slate-200 hover:bg-dark-800/60 focus:ring-slate-500",
    discord:
      "bg-discord-blurple text-white font-semibold hover:bg-discord-blurpleHover focus:ring-discord-blurple shadow-md shadow-discord-blurple/25",
  };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon && <span className="flex-shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
};
