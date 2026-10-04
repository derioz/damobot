# DamoBot Dashboard React Bits Design Directive

This rule applies whenever you:
- **Make changes to the DamoBot dashboard** (`dashboard/`)
- **Add new features, pages, modals, or settings to the dashboard**
- **Create or style any web UI component for DamoBot**

---

## 1. Mandatory React Bits Component Usage

Whenever you build, enhance, or modify components in the DamoBot web dashboard, you MUST always incorporate components, animations, and interaction patterns from **[React Bits](https://github.com/DavidHDev/react-bits.git)**.

Avoid generic, flat, or static UI templates. The dashboard must feel **minimal, modern, dark, premium, fast, and alive with polished micro-interactions**.

---

## 2. Creative Component Selection Guide

Be creative, deliberate, and varied in the component choices you integrate across different dashboard contexts:

### A. Cards & Container Surfaces
* **`SpotlightCard`**: Mouse-following radial glow highlight on hover. Use on module grid cards, metric summaries, and settings panels.
* **`BorderGlow`**: Animated gradient border sweep. Use for active modules, highlighted alerts, and selected items.
* **`TiltedCard`**: Subtle 3D perspective tilt following cursor. Use on featured module highlights or hero cards.
* **`PixelCard`**: Interactive pixel shimmer effect. Great for system storage cards, Cloudflare DO metrics, or technical readouts.

### B. Typography & Text Effects
* **`BlurText`**: Progressive blur-to-sharp animated entrance. Use on page headers, major section titles, and modal headlines.
* **`DecryptedText` / `ScrambleText`**: Cyberpunk-style letter decoding animation. Perfect for sequential IDs (`VRP-P-XXXXXX`), version badges (`v0.9.91`), and security verification prompts.
* **`ShinyText`**: Shimmering light sweep across text. Use on primary CTA buttons, premium badges, and "Save Changes" indicators.
* **`CountUp`**: Smoothly animated numbers. Use for metric counters (active modules, open refunds, punishment cases).

### C. Navigation, Tabs & Lists
* **`FluidTabs`**: Smooth sliding pill indicator between tabs. Use on category filters ("All", "Staff Only", "Community", "Utility").
* **`AnimatedList`**: Staggered spring entrance for list items. Use in the Audit Log, Discord Role explorer, and search results.
* **`Dock`**: Spring-physics magnification dock. Ideal for quick-navigation utility bars or floating action trays.

### D. Inputs & Micro-Interactions
* **`MagneticButton`**: Buttons that gently pull toward the cursor. Use on primary action buttons like "Save Changes", "Add Category", or "Login".
* **`ElasticSlider`**: Spring-physics sliders with rubber-band feedback for numeric values (cooldowns, days, limits).
* **`ToggleSwitch`**: Smooth toggle with spring thumb movement for module and category active switches.

### E. Backgrounds & Empty States
* **`GridDistortion` / `Particles`**: Subtle, dark interactive grid or dust particles. Use sparingly on the Login page, empty state banners, or page headers.
* Must always stay dark-mode-first (`#08090D` base, `#0E1017` panels) and never distract from forms or inputs.

---

## 3. Usability & Quality Rules

1. **Admin Usability First**: The dashboard is a real control panel for server operations. Animations must enhance delight and feedback—never delay user interaction or block fast editing.
2. **`prefers-reduced-motion`**: Respect user accessibility preferences by disabling heavy transitions when reduced motion is requested.
3. **No External Heavy Bundles**: Implement React Bits patterns cleanly using Tailwind CSS, Framer Motion/CSS transitions, and lightweight React hooks without bloating bundle size.
4. **Consistency**: Use the established DamoBot color palette:
   * **Vital RP Orange**: `#FAA200`
   * **Deep Backgrounds**: `#08090D`, `#0E1017`, `#141721`
   * **Borders**: `#242A3D`, `#31384E`
   * **Discord Blurple**: `#5865F2`
