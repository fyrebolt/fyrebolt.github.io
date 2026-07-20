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
//   - timemachine: one continuous SPEED keyframe track (variable playback speed /
//              slow-mo replays / freezes). It draws nothing — instead it warps the
//              output→source clock (see project/timeMap.ts), generalising the
//              banner freeze. Singleton, video-only.
//
// Session 2 adds three more overlay variants, each embedding its existing domain
// object the same way `caption` embeds CaptionEl and reusing its render.ts draw
// function:
//   - sketch:      a freehand drawing (SketchElement) projected into a placement
//                  box, replayed at constant arc-length velocity. Multi-instance.
//   - highlighter: a free, timed highlight box (Highlighter) that sweeps in/out.
//                  Multi-instance.
//   - dramatic:    one big uppercase word call-out (DramaticWord) in normal /
//                  inverse / reflection mode. Multi-instance, but words never
//                  overlap in TIME (only one effect active at a moment) — the
//                  timeline clamps drags to neighbours and adds fill free gaps.

import type { BannerPosition, BannerStyle, FillMode, RatioKey } from '../types';
import type { CaptionEl } from '../captions/types';
import { createCaption, createTypewriter, elementEnd as captionEnd } from '../captions/types';
import type { ZoomKeyframe } from '../zoom/types';
import type { SpeedKeyframe } from '../timemachine/types';
import type { BoilPoolId } from '../captions/fonts';
import type { SketchElement } from '../sketch/types';
import { createSketch, elementEnd as sketchEnd } from '../sketch/types';
import type { Highlighter } from '../highlight/types';
import { createHighlighter, elementEnd as highlightEnd } from '../highlight/types';
import type { DramaticWord, WordMode } from '../dramatic/types';
import { elementEnd as dramaticEnd } from '../dramatic/types';
import type { StickerElement, StickerSeed } from '../sticker/types';
import { createSticker, elementEnd as stickerEnd } from '../sticker/types';
import type { VideoClip } from './clips';
import { baseDuration } from './clips';

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

/** The single sequential playback-speed track. Warps the clock, draws nothing. */
export interface TimeMachineLayer extends LayerBase {
  kind: 'timemachine';
  keyframes: SpeedKeyframe[];
}

/** One projected freehand sketch (drawing + placement + replay timing). */
export interface SketchLayer extends LayerBase {
  kind: 'sketch';
  el: SketchElement;
}

/** One free, timed highlight box that sweeps in, holds, then sweeps out. */
export interface HighlighterLayer extends LayerBase {
  kind: 'highlighter';
  el: Highlighter;
}

/** One big uppercase word call-out (normal / inverse / reflection). */
export interface DramaticLayer extends LayerBase {
  kind: 'dramatic';
  el: DramaticWord;
}

/** One image / video sticker composited onto the frame (placed + cropped + timed). */
export interface StickerLayer extends LayerBase {
  kind: 'sticker';
  el: StickerElement;
}

export type Layer =
  | BannerLayer
  | CaptionLayer
  | ZoomLayer
  | TimeMachineLayer
  | SketchLayer
  | HighlighterLayer
  | DramaticLayer
  | StickerLayer;

export type LayerKind = Layer['kind'];

/** Everything the compositor needs to draw + export the whole project. */
export interface Project {
  /** Ordered base timeline: clips concatenate into one continuous source clock.
   *  Empty for a not-yet-loaded project. A single clip == the old single source. */
  clips: VideoClip[];
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

/** Total base-sequence duration (sum of trimmed clip lengths), in seconds. */
export function projectBaseDuration(p: Project): number {
  return baseDuration(p.clips);
}

/** The media kind of the sequence: 'video' if any clip is video, else 'image', else null. */
export function projectMediaKind(p: Project): 'video' | 'image' | null {
  if (p.clips.length === 0) return null;
  return p.clips.some((c) => c.kind === 'video') ? 'video' : 'image';
}

export function bannerLayer(p: Project): BannerLayer | null {
  return (p.layers.find((l) => l.kind === 'banner') as BannerLayer | undefined) ?? null;
}

export function zoomLayer(p: Project): ZoomLayer | null {
  return (p.layers.find((l) => l.kind === 'zoom') as ZoomLayer | undefined) ?? null;
}

export function timeMachineLayer(p: Project): TimeMachineLayer | null {
  return (p.layers.find((l) => l.kind === 'timemachine') as TimeMachineLayer | undefined) ?? null;
}

/** Overlay layers (everything that draws ON TOP of the base), sorted bottom-first by z. */
export function overlayLayers(p: Project): Layer[] {
  // zoom (base crop) and timemachine (clock warp) draw nothing on top.
  return p.layers.filter((l) => l.kind !== 'zoom' && l.kind !== 'timemachine').sort((a, b) => a.z - b.z);
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
    case 'timemachine': {
      const end = layer.keyframes.reduce((m, k) => Math.max(m, k.start + k.duration), 0);
      return { start: 0, end };
    }
    case 'sketch':
      return { start: layer.el.start, end: sketchEnd(layer.el) };
    case 'highlighter':
      return { start: layer.el.start, end: highlightEnd(layer.el) };
    case 'dramatic':
      return { start: layer.el.start, end: dramaticEnd(layer.el) };
    case 'sticker':
      return { start: layer.el.start, end: stickerEnd(layer.el) };
  }
}

/** Active OUTPUT-second spans of every dramatic layer except `exceptId`. */
export function dramaticSpans(layers: Layer[], exceptId?: string): Span[] {
  return layers
    .filter((l): l is DramaticLayer => l.kind === 'dramatic' && l.id !== exceptId)
    .map((l) => ({ start: l.el.start, end: dramaticEnd(l.el) }));
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

export function createTimeMachineLayer(z: number, overrides: Partial<TimeMachineLayer> = {}): TimeMachineLayer {
  return {
    kind: 'timemachine',
    id: id('tm'),
    z,
    name: 'Time Machine',
    keyframes: [],
    ...overrides,
  };
}

/** New sketch overlay. `padAspect` is the drawing pad's ratio (usually the output AR). */
export function createSketchLayer(
  z: number,
  padAspect: number,
  overrides: Partial<SketchLayer> = {},
): SketchLayer {
  return {
    kind: 'sketch',
    id: id('sketch'),
    z,
    name: 'Sketch',
    el: createSketch({ padAspect, x: 0, y: 0, w: 1, h: 1 }),
    ...overrides,
  };
}

export function createHighlighterLayer(z: number, overrides: Partial<HighlighterLayer> = {}): HighlighterLayer {
  return {
    kind: 'highlighter',
    id: id('hl'),
    z,
    name: 'Highlighter',
    el: createHighlighter(),
    ...overrides,
  };
}

export function createDramaticLayer(
  z: number,
  mode: WordMode,
  el: DramaticWord,
  overrides: Partial<DramaticLayer> = {},
): DramaticLayer {
  return {
    kind: 'dramatic',
    id: id('dram'),
    z,
    name: mode === 'inverse' ? 'Inverse word' : mode === 'reflection' ? 'Reflection word' : 'Dramatic word',
    el,
    ...overrides,
  };
}

export function createStickerLayer(
  z: number,
  seed: StickerSeed,
  overrides: Partial<StickerLayer> = {},
): StickerLayer {
  return {
    kind: 'sticker',
    id: id('stk'),
    z,
    name: seed.source === 'video' ? 'Video sticker' : 'Image sticker',
    el: createSticker(seed),
    ...overrides,
  };
}
