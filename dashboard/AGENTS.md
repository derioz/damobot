# DamoBot Dashboard Agent Guidelines

## React Bits Design Directive

Whenever making changes to, styling, or adding new features/components to this dashboard:
- **Always use React Bits**: Integrate animations, micro-interactions, components, and effects inspired by or adapted from [React Bits](https://github.com/DavidHDev/react-bits.git).
- **Be Creative with Component Choices**:
  - **Cards & Surfaces**: `SpotlightCard` (mouse-following glow), `BorderGlow` (animated gradient borders), `TiltedCard` (3D perspective tilt), `PixelCard` (technical reveal).
  - **Text & Headers**: `BlurText` (smooth blur-to-sharp entrance), `DecryptedText` / `ScrambleText` (cyberpunk decoding for IDs/versions), `ShinyText` (shimmer sweep), `CountUp` (number transitions).
  - **Navigation & Lists**: `FluidTabs` (sliding pill indicator), `AnimatedList` (staggered spring entrance for lists/audits), `Dock` (spring-physics magnification).
  - **Micro-Interactions**: `MagneticButton` (magnetic cursor pull), `ElasticSlider` (spring sliders for numbers), smooth `ToggleSwitch`.
  - **Backgrounds**: Subtle animated dark mesh grids and ambient particles matching `#08090D` and `#0E1017`.
- **Maintain Usability & Performance**: Keep animations sleek, responsive, and functional for daily admin work without cluttering forms or inputs. Always respect `prefers-reduced-motion`.
