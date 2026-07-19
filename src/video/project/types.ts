// ===== Unified project + layer model =====
//
// The layer-based editor composites any mix of layers over ONE source clip on
// ONE shared timeline. A layer is a discriminated union spanning genuinely
// different shapes:
//   - banner:  a single freeze-point marker + banner styling. The freeze is a
//              global time distortion — the whole composite HOLDS on the freeze
//              frame for `hold` seconds, then resumes (see project/timeMap.ts).
//              Singleton (one freeze per project).
//   - caption: one draggable text element — a font-boil caption (start/end) or a
//              typewriter (typing/hold/delete phases), each with optional word
//              highlight/underline attachments. Multi-instance.
//   - zoom:    NOT independent elements — one continuous keyframe track. The crop
//              replaces the base frame, so it is a singleton base layer.
//
// Extensibility: dramatic / sketch / highlighter (not built this session) slot in
// as additional overlay variants — each embeds its existing domain object the
// same way `caption` embeds CaptionEl and reuses its render.ts draw function.

import type { BannerPosition, BannerStyle, FillMode, RatioKey } from '../types';
import type { CaptionEl } from '../captions/types';
import { createCaption, createTypewriter, elementEnd as captionEnd } from '../captions/types';
import type { ZoomKeyframe } from '../zoom/types';
import type { BoilPoolId } from '../captions/fonts';

export interface LayerBase {
  id: string;
  /** Paint order among OVERLAY layers (higher = on top). Ignored for the zoom base. */
  z: number;
  /** Human label shown in the layers list and its timeline row. */
  name: string;
}

/** Entrance banner: styling + the freeze sequence. All times in seconds. */
export interface BannerLayer extends LayerBase {
  kind: 'banner';
  style: BannerStyle;
  position: BannerPosition;
  /** Freeze/lock point in SOURCE seconds (where the clip pauses as the banner locks). */
  freeze: number;
  /** Slide-in / hold / fade-out durations in seconds. `hold` is the frozen span. */
  slideIn: number;
  hold: number;
  fadeOut: number;
  /** Play the musical entrance slash when the banner locks. */
  sfx: boolean;
}

/** One text overlay element (font-boil or typewriter), timed in OUTPUT seconds. */
export interface CaptionLayer extends LayerBase {
  kind: 'caption';
  el: CaptionEl;
}

/** The single sequential zoom track. Its crop replaces the base frame. */
export interface ZoomLayer extends LayerBase {
  kind: 'zoom';
  keyframes: ZoomKeyframe[];
}

export type Layer = BannerLayer | CaptionLayer | ZoomLayer;

export type LayerKind = Layer['kind'];

/** Everything the compositor needs to draw + export the whole project. */
export interface Project {
  layers: Layer[];
  ratio: RatioKey;
  fillMode: FillMode;
  /** Font-boil pool (project-global, shared by every caption layer). */
  boilPool: BoilPoolId;
  /** Per-font height normalisation for font-boil captions. */
  normalize: boolean;
  /** Master SFX toggle + bus gain (0..1). */
  sfxEnabled: boolean;
  sfxVolume: number;
  /** For image sources: fixed total output length (seconds). Ignored for video. */
  imageDuration?: number;
}

// ---- classification helpers ----

export function bannerLayer(p: Project): BannerLayer | null {
  return (p.layers.find((l) => l.kind === 'banner') as BannerLayer | undefined) ?? null;
}

export function zoomLayer(p: Project): ZoomLayer | null {
  return (p.layers.find((l) => l.kind === 'zoom') as ZoomLayer | undefined) ?? null;
}

/** Overlay layers (everything that draws ON TOP of the base), sorted bottom-first by z. */
export function overlayLayers(p: Project): Layer[] {
  return p.layers.filter((l) => l.kind !== 'zoom').sort((a, b) => a.z - b.z);
}

/** Next z for a newly-added overlay (on top of the current stack). */
export function nextZ(p: Project): number {
  return p.layers.reduce((m, l) => Math.max(m, l.z), 0) + 1;
}

// ---- per-layer timeline extent (OUTPUT seconds) ----

export interface Span {
  start: number;
  end: number;
}

/** The on-timeline extent of a layer in OUTPUT seconds (for its row + duration calc). */
export function layerSpan(layer: Layer): Span {
  switch (layer.kind) {
    case 'banner':
      // Slide begins before the freeze; the fling-out ends after the hold.
      return {
        start: Math.max(0, layer.freeze - layer.slideIn),
        end: layer.freeze + layer.hold + layer.fadeOut,
      };
    case 'caption':
      return { start: layer.el.start, end: captionEnd(layer.el) };
    case 'zoom': {
      const end = layer.keyframes.reduce((m, k) => Math.max(m, k.start + k.duration), 0);
      return { start: 0, end };
    }
  }
}

// ---- factories ----

let uid = 0;
function id(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

export function createBannerLayer(z: number, overrides: Partial<BannerLayer> = {}): BannerLayer {
  return {
    kind: 'banner',
    id: id('banner'),
    z,
    name: 'Entrance Banner',
    style: {
      name: 'YOUR NAME',
      tagline: 'ENTERS THE BATTLE!',
      primary: '#151a2e',
      accent: '#e5183b',
      text: '#ffffff',
      glow: true,
      speedLines: true,
      metallic: true,
      chevrons: true,
      scanlines: true,
    },
    position: 'lower',
    freeze: 1.5,
    slideIn: 0.42,
    hold: 1.6,
    fadeOut: 0.36,
    sfx: false,
    ...overrides,
  };
}

export function createCaptionLayer(
  variant: 'boil' | 'typewriter',
  z: number,
  overrides: Partial<CaptionLayer> = {},
): CaptionLayer {
  const el = variant === 'boil' ? createCaption() : createTypewriter();
  return {
    kind: 'caption',
    id: id('cap'),
    z,
    name: variant === 'boil' ? 'Caption' : 'Typewriter',
    el,
    ...overrides,
  };
}

export function createZoomLayer(z: number, overrides: Partial<ZoomLayer> = {}): ZoomLayer {
  return {
    kind: 'zoom',
    id: id('zoom'),
    z,
    name: 'Zoom',
    keyframes: [],
    ...overrides,
  };
}
