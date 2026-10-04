import React from "react";
import { cn } from "../../utils/cn";

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded bg-dark-750", className)} />
);

export const SkeletonCard: React.FC = () => (
  <div className="rounded-xl border border-dark-750 bg-dark-850 p-6 space-y-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="w-32 h-4" />
          <Skeleton className="w-20 h-3" />
        </div>
      </div>
      <Skeleton className="w-10 h-5 rounded-full" />
    </div>
    <Skeleton className="w-full h-12 rounded" />
    <div className="flex items-center justify-between pt-2 border-t border-dark-750">
      <Skeleton className="w-24 h-4" />
      <Skeleton className="w-16 h-8 rounded" />
    </div>
  </div>
);
