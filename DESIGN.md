---
name: Frappé Ethereal
colors:
  surface: '#0e1223'
  surface-dim: '#0e1223'
  surface-bright: '#34384b'
  surface-container-lowest: '#090d1d'
  surface-container-low: '#171b2c'
  surface-container: '#1b1f30'
  surface-container-high: '#25293b'
  surface-container-highest: '#303446'
  on-surface: '#dee1f9'
  on-surface-variant: '#c4c6d1'
  inverse-surface: '#dee1f9'
  inverse-on-surface: '#2c3041'
  outline: '#8e909b'
  outline-variant: '#434750'
  surface-tint: '#aec6ff'
  primary: '#aec6ff'
  on-primary: '#022e6a'
  primary-container: '#8caaee'
  on-primary-container: '#1a3d7a'
  inverse-primary: '#3e5d9c'
  secondary: '#c1c2f8'
  on-secondary: '#2a2c58'
  secondary-container: '#434573'
  on-secondary-container: '#b3b4e9'
  tertiary: '#a8d38b'
  on-tertiary: '#153802'
  tertiary-container: '#8cb671'
  on-tertiary-container: '#24470f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#aec6ff'
  on-primary-fixed: '#001a43'
  on-primary-fixed-variant: '#244582'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c1c2f8'
  on-secondary-fixed: '#151642'
  on-secondary-fixed-variant: '#414270'
  tertiary-fixed: '#c3efa4'
  tertiary-fixed-dim: '#a8d38b'
  on-tertiary-fixed: '#092100'
  on-tertiary-fixed-variant: '#2c4f16'
  background: '#0e1223'
  on-background: '#dee1f9'
  surface-variant: '#303446'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 24px
  container-max: 1200px
---

## Brand & Style
This design system leverages a soft-dark aesthetic characterized by low-eye-strain contrast and a soothing color temperature. The target audience includes developers, creative professionals, and night-owl power users who value long-form focus and a high degree of visual refinement.

The style is a hybrid of **Minimalism** and **Glassmorphism**. It utilizes semi-transparent layers and backdrop blurs to create a sense of environmental depth without the harshness of high-contrast shadows. The emotional response should be one of calm, precision, and digital comfort.

## Colors
The palette is rooted in the Frappé flavor of the Catppuccin color scheme, prioritizing a desaturated blue-gray base that feels expansive and cool. 

- **Primary (Blue):** Used for main actions and active states.
- **Secondary (Lavender):** Used for supportive UI elements and decorative highlights.
- **Surface (Crust):** Applied to recessed containers and background layers.
- **Text & Subtext:** Hierarchy is established through the transition from high-readability Text to the muted Subtext for metadata.

## Typography
Typography is split between the systematic clarity of **Inter** for all functional UI and prose, and **JetBrains Mono** for technical identifiers, data points, and code snippets. 

Headlines use tight letter-spacing to maintain a modern, "locked-in" appearance. Body text maintains generous line heights to ensure readability against the dark background. For mobile devices, `headline-xl` should scale down to 32px and `headline-lg` to 28px.

## Layout & Spacing
The layout follows a **fluid grid** model with an 8px base rhythm. This ensures consistent alignment across all components.

- **Desktop:** 12-column grid, 32px margins, 24px gutters.
- **Tablet:** 8-column grid, 24px margins, 16px gutters.
- **Mobile:** 4-column grid, 16px margins, 16px gutters.

Large containers should use the primary background color, while internal modules use the Surface (Crust) color to create a clear "carved-out" visual hierarchy.

## Elevation & Depth
Depth is created through **Glassmorphism** and **Tonal Layers** rather than heavy shadows.

- **Level 1 (Base):** #303446 (Base).
- **Level 2 (Recessed):** #292c3c (Crust).
- **Level 3 (Elevated):** Semi-transparent white (5% opacity) overlays with a `20px` backdrop blur. This is reserved for modals, navigation bars, and floating action menus.
- **Borders:** Instead of shadows, use 1px solid borders using the Subtext color at 10% opacity to define edges softly.

## Shapes
The design system adopts a **Rounded** shape language to reinforce the "gentle" brand personality. 

- **Standard Buttons & Inputs:** 16px (1rem) corner radius.
- **Small Components (Chips/Badges):** Fully pill-shaped.
- **Large Containers (Cards/Modals):** 24px (1.5rem) corner radius to create a soft, friendly structure.

## Components

### Buttons
- **Primary:** Filled with Primary (Blue), text in Base (#303446) for maximum contrast.
- **Secondary:** Outlined with Secondary (Lavender) at 40% opacity, text in Secondary.
- **Ghost:** No background, text in Subtext. On hover, apply a 10% Primary color tint background.

### Inputs
- **Field:** Background in Surface (Crust), 16px radius, 1px border using Subtext at 20% opacity.
- **Focus State:** 2px border using Primary (Blue) with a subtle outer glow (4px blur, same color).

### Cards
- **Style:** Background color #292c3c (Crust).
- **Interactive:** On hover, increase brightness by 5% and add a 12px backdrop blur if the card is floating.

### Chips & Badges
- **Status:** Use Accent (Success), Warning, and Error colors at 15% opacity for backgrounds, with full-saturation text of the same color for labels. High-legibility monospaced font should be used for the label.

### Lists
- Separate list items with a subtle 1px divider using the Crust color. Active items should use a vertical 4px "pill" indicator on the left edge in the Primary color.