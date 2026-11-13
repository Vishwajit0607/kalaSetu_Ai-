/**
 * Single source of truth for the KalaSetu visual language.
 *
 * The palette is tuned for one specific constraint: an artisan reading this
 * screen in direct Indian afternoon sun, on a 400-nit budget handset. That is
 * why the canvas is near-black and the accent is a 90%-luminance chartreuse -
 * the pair clears WCAG AAA at 16px, where a softer brand green would wash out.
 *
 * Tailwind classes consume these via tailwind.config.js; Skia, Reanimated and
 * expo-linear-gradient need the raw values, so both read from here.
 */

export const colors = {
  /** Primary screen background. */
  canvasObsidian: '#060705',
  /** Translucent bento cards (85% over canvas). */
  surfaceCharcoal: '#11150E',
  /** Modals and bottom sheets (95%). */
  surfaceElevated: '#181E13',
  /** Primary accent and highlights. */
  electricLime: '#A8EB34',
  /** Active bento card gradient terminus. */
  limeGradientEnd: '#78C214',
  /** Background radial spotlights (25%). */
  ambientOliveGlow: '#4A6B1D',
  /** Card and pill outlines (60%). */
  borderHairline: '#2C381E',
  /** Primary headings and values. */
  textPureWhite: '#FFFFFF',
  /** Subtitles and helper labels. */
  textMutedSage: '#9BA394',
  /** Text on solid lime surfaces. */
  textInverseDark: '#080A06',
} as const;

export const opacity = {
  surfaceCharcoal: 0.85,
  surfaceElevated: 0.95,
  ambientGlow: 0.25,
  borderHairline: 0.6,
} as const;

/** Active bento card / primary CTA gradient. */
export const limeGradient = [colors.electricLime, colors.limeGradientEnd] as const;

/** Radial spotlight stops for the olive ambient glow behind product stages. */
export const oliveGlowStops = [
  'rgba(74, 107, 29, 0.42)',
  'rgba(74, 107, 29, 0.18)',
  'rgba(6, 7, 5, 0)',
] as const;

export const radii = {
  bento: 28,
  card: 20,
  pill: 999,
  stage: 999,
} as const;

export const spacing = {
  gutter: 20,
  cardGap: 12,
  sectionGap: 28,
} as const;

/**
 * Minimum 56px touch targets throughout: the target user is often an older
 * weaver with calloused fingertips, outdoors, sometimes with a child in arm.
 */
export const touch = {
  minTarget: 56,
  circleButton: 48,
  voiceOrb: 132,
} as const;

export const typography = {
  display: 34,
  title: 26,
  heading: 20,
  body: 16,
  label: 13,
  /** Numbered bento labels (01 / 02 / 03). */
  stepNumber: 15,
} as const;

/** Keep every animation at or under this budget to hold 60fps on an A-series Android. */
export const motion = {
  fast: 160,
  base: 240,
  slow: 420,
  springy: { damping: 18, stiffness: 180, mass: 0.9 },
} as const;

export type ColorToken = keyof typeof colors;
