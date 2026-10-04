---
name: react-bits-dashboard
description: >-
  Use this skill whenever building, modifying, styling, or adding new features and UI components
  to the DamoBot web dashboard. Provides component patterns, animations, and micro-interactions
  from React Bits (https://github.com/DavidHDev/react-bits.git) tailored for a dark, minimal,
  and high-performance admin control panel.
---

# React Bits Dashboard Integration Skill

When building or updating any part of the DamoBot web dashboard, always use components and micro-interactions inspired by or adapted from [React Bits](https://github.com/DavidHDev/react-bits.git).

---

## 1. Quick Component Recipes

### A. SpotlightCard (Mouse-Tracking Radial Glow)
```tsx
import React, { useRef, useState } from "react";

export const SpotlightCard: React.FC<{ children: React.ReactNode; spotlightColor?: string }> = ({
  children,
  spotlightColor = "rgba(250, 162, 0, 0.08)",
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  return (
    <div
      ref={divRef}
      onMouseMove={(e) => {
        if (!divRef.current) return;
        const rect = divRef.current.getBoundingClientRect();
        setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className="relative rounded-xl border border-dark-750 bg-dark-850 p-6 overflow-hidden transition-colors hover:border-dark-700"
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 40%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
};
```

### B. BorderGlow (Animated Shifting Gradient Border)
```tsx
export const BorderGlow: React.FC<{ children: React.ReactNode; active?: boolean }> = ({
  children,
  active = false,
}) => (
  <div className="relative group rounded-xl p-[1px] overflow-hidden">
    <div
      className={`absolute inset-0 bg-gradient-to-r transition-all duration-500 rounded-xl ${
        active
          ? "from-brand-orange/40 via-amber-500/20 to-transparent"
          : "from-dark-750 via-dark-700 to-dark-750 group-hover:from-dark-700 group-hover:to-dark-600"
      }`}
    />
    <div className="relative rounded-[11px] bg-dark-850 h-full w-full">{children}</div>
  </div>
);
```

### C. DecryptedText / ScrambleText (Cyberpunk Decoded Numbers/IDs)
Use for sequential case IDs (e.g. `VRP-P-000142`), version tags (`v0.9.91-beta`), and security prompts.

### D. BlurText (Blur-to-Focus Page Titles)
Use for hero section headings, modal titles, and metric readouts.

### E. FluidTabs (Smooth Sliding Indicator)
Use for tab filter rows (e.g. Category filters, log filters) with a spring-physics sliding background pill.

---

## 2. Creative Selection Matrix

UI Element               | React Bits Component Choice
:----------------------- | :--------------------------
Module Card Grid         | `SpotlightCard` + `BorderGlow` on active state
Hero Stat Counter        | `CountUp` + `BlurText`
Sequential Case ID Pill  | `DecryptedText` / `ScrambleText`
Category Tabs            | `FluidTabs` (sliding pill indicator)
Save / Action Buttons    | `ShinyText` shimmer + `MagneticButton` pull
Audit Log / Feed Items   | `AnimatedList` (staggered spring entrance)
Number Inputs (cooldown) | `ElasticSlider` (spring feedback)
Empty State Banner       | `GridDistortion` or subtle particle sweep

---

## 3. Aesthetic Guidelines

- **Theme Palette:**
  - Base: `#08090D`
  - Panels / Sidebar: `#0E1017`
  - Card Surfaces: `#141721`
  - Border Accents: `#242A3D`, `#31384E`
  - Brand Orange: `#FAA200`
  - Discord Blurple: `#5865F2`
- **Performance First:** No CPU-heavy canvas loops or large WebGL shaders on active form pages. Respect `prefers-reduced-motion`.
