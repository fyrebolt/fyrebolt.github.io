// ===== Video Editor types =====

export type FillMode = 'crop' | 'blur';

export type RatioKey = '9:16' | '1:1' | '4:5' | 'original';

export type BannerPosition = 'top' | 'middle' | 'lower' | 'bottom';

export interface OutputSize {
  w: number;
  h: number;
}

/** Visual style of the character-intro banner. */
export interface BannerStyle {
  name: string;
  tagline: string;
  /** Dark base band colour. */
  primary: string;
  /** Bright accent slash / plate colour. */
  accent: string;
  /** Name text colour. */
  text: string;
}

/** Per-frame animation state handed to the banner renderer. */
export interface BannerFrame {
  /** Slide progress; 0 = fully off-screen, 1 = locked. May exceed 1 for overshoot. */
  slide: number;
  /** Opacity, 0..1 (drives the fade-out). */
  alpha: number;
  /** Full-frame white flash intensity, 0..1. */
  flash: number;
  /** Vertical anchor of the name plate as a fraction of frame height, 0..1. */
  anchor: number;
}

/** Timing of the banner sequence, in milliseconds. */
export interface Timing {
  /** For video: absolute freeze point in the clip (ms). For photo: delay before slide-in. */
  freeze: number;
  slideIn: number;
  hold: number;
  fadeOut: number;
  /** Photo-mode total clip length (ms); ignored for video. */
  total: number;
}

/** Everything the renderer/player needs for a single frame. */
export interface EditorConfig {
  style: BannerStyle;
  timing: Timing;
  fillMode: FillMode;
  ratio: RatioKey;
  position: BannerPosition;
}

export const RATIOS: Record<Exclude<RatioKey, 'original'>, OutputSize> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};

/** Vertical anchor (fraction of height) for the name plate centre per position.
 *  'lower' is the default — clear of the ~13% top and ~20% bottom platform UI zones. */
export const POSITION_ANCHORS: Record<BannerPosition, number> = {
  top: 0.16,
  middle: 0.5,
  lower: 0.7,
  bottom: 0.86,
};
