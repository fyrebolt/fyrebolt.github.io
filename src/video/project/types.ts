// ===== Unified project + layer model =====
//
// The layer-based editor composites any mix of layers over ONE source clip on
// ONE shared timeline. A layer is a discriminated union spanning genuinely
// different shapes:
//   - banner:  a freeze-point marker + banner styling. The freeze is a global
//              time distortion — the whole composite HOLDS on the freeze frame
//              for `hold` seconds, then resumes (see project/timeMap.ts).
//              Multi-instance: any number of independent banners, each with its
//              own style/position/freeze/hold/fade/sfx. Because each banner's
//              freeze+hold pauses the ONE base clock (as does a Time Machine
//              warp), no banner's freeze+hold window may overlap another
//              banner's window or a non-1× Time Machine segment — the editor
//              clamps placements to keep these windows disjoint.
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
import type { SpeedPoint } from '../timemachine/types';
import type { BoilPoolId } from '../captions/fonts';
import type { SketchElement } from '../sketch/types';
import { createSketch, elementEnd as sketchEnd } from '../sketch/types';
import type { Highlighter } from '../highlight/types';
import { createHighlighter, elementEnd as highlightEnd } from '../highlight/types';
import type { DramaticWord, WordMode } from '../dramatic/types';
import { elementEnd as dramaticEnd } from '../dramatic/types';
import type { StickerElement, StickerSeed } from '../sticker/types';
import { createSticker, elementEnd as stickerEnd } from '../sticker/types';
import type { MusicElement, MusicSeed } from '../music/types';
import { createMusic, elementEnd as musicEnd } from '../music/types';
import type { VideoClip } from './clips';
import type { ColorGrade } from './grade';

export interface LayerBase {
  id: string;
  /** Paint order among OVERLAY layers (higher = on top). Ignored for the zoom base. */
  z: number;
  /** Human label shown in the layers list and its timeline row. */
  name: string;
  /**
   * Muted from the OUTPUT entirely: the layer draws nothing, plays no audio, and
   * contributes no time distortion (a hidden banner does not freeze; a hidden
   * Time Machine does not warp). It keeps its row and panel so it can be edited
   * and switched back on. Enforced in ONE place — `activeProject` below strips
   * hidden layers from the project the compositor and the warp ever see.
   * Absent/false == visible, so projects saved before this are unchanged.
   */
  hidden?: boolean;
  /**
   * Protected from POSITIONAL edits: canvas drag / resize / rotate, group move,
   * marquee pick-up, timeline drag, arrow-nudge, and delete. Its property panel
   * stays live — that is deliberately the escape hatch, both for unlocking and
   * for precise numeric edits that can't be made by accident.
   * Absent/false == unlocked.
   */
  locked?: boolean;
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

/** The single playback-speed curve. Warps the clock, draws nothing. */
export interface TimeMachineLayer extends LayerBase {
  kind: 'timemachine';
  /** Free-form speed curve (OUTPUT seconds → speed). Empty == flat 1×. */
  points: SpeedPoint[];
  /** Play a whoosh at each slow-mo / replay onset. Per-instance SFX toggle. */
  whoosh: boolean;
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

/** One background-music track: independent audio on the OUTPUT clock (not warped). */
export interface MusicLayer extends LayerBase {
  kind: 'music';
  el: MusicElement;
}

export type Layer =
  | BannerLayer
  | CaptionLayer
  | ZoomLayer
  | TimeMachineLayer
  | SketchLayer
  | HighlighterLayer
  | DramaticLayer
  | StickerLayer
  | MusicLayer;

export type LayerKind = Layer['kind'];

/** Everything the compositor needs to draw + export the whole project. */
export interface Project {
  /** Ordered base timeline: clips concatenate into one continuous source clock.
   *  Empty for a not-yet-loaded project. A single clip == the old single source. */
  clips: VideoClip[];
  layers: Layer[];
  ratio: RatioKey;
  fillMode: FillMode;
  /** Pool a NEWLY added boil caption starts on. Seed only — each caption then
   *  owns its own `pool` (see Caption), so this never affects existing captions
   *  or rendering. */
  defaultBoilPool: BoilPoolId;
  /** Even-sizing a NEWLY added boil caption starts with. Seed only — same story
   *  as `defaultBoilPool`; rendering reads each caption's own `normalize`. */
  defaultNormalize: boolean;
  /** Master SFX toggle + bus gain (0..1). */
  sfxEnabled: boolean;
  sfxVolume: number;
  /** For image sources: fixed total output length (seconds). Ignored for video. */
  imageDuration?: number;
  /** Global colour grade over the WHOLE composited output (base + overlays),
   *  applied as a final pass. Absent == neutral. Composes on top of any per-clip
   *  grade. */
  grade?: ColorGrade;
}

// ---- hidden layers: one authoritative filter ----

/**
 * The project as it RENDERS: hidden layers removed outright. Every consumer that
 * produces output — the compositor's draw loop, its audio graph, its hit-test,
 * and the time-warp compiler — reads the project through this, so "hidden" is
 * enforced once here instead of being re-checked at a dozen draw sites.
 *
 * Editor-side consumers (the layers list, the timeline rows, the property panels)
 * deliberately use the RAW project, so a hidden layer stays visible as a row you
 * can select, edit, and un-hide.
 *
 * Returns the input object untouched when nothing is hidden, which is the common
 * case — identity matters because the compositor caches its compiled warp by
 * project identity and would otherwise recompile every frame.
 */
export function activeProject(p: Project): Project {
  if (!p.layers.some((l) => l.hidden)) return p;
  return { ...p, layers: p.layers.filter((l) => !l.hidden) };
}

// ---- classification helpers ----

/** Every banner layer, in paint order (banners are multi-instance). */
export function bannerLayers(p: Project): BannerLayer[] {
  return p.layers.filter((l): l is BannerLayer => l.kind === 'banner');
}

export function zoomLayer(p: Project): ZoomLayer | null {
  return (p.layers.find((l) => l.kind === 'zoom') as ZoomLayer | undefined) ?? null;
}

export function timeMachineLayer(p: Project): TimeMachineLayer | null {
  return (p.layers.find((l) => l.kind === 'timemachine') as TimeMachineLayer | undefined) ?? null;
}

/** Overlay layers (everything that draws ON TOP of the base), sorted bottom-first by z. */
export function overlayLayers(p: Project): Layer[] {
  // zoom (base crop), timemachine (clock warp) and music (audio) draw nothing.
  return p.layers
    .filter((l) => l.kind !== 'zoom' && l.kind !== 'timemachine' && l.kind !== 'music')
    .sort((a, b) => a.z - b.z);
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
      const end = layer.points.reduce((m, p) => Math.max(m, p.t), 0);
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
    case 'music':
      return { start: layer.el.start, end: musicEnd(layer.el) };
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
    points: [],
    whoosh: false,
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

export function createMusicLayer(
  z: number,
  seed: MusicSeed,
  start: number,
  overrides: Partial<MusicLayer> = {},
): MusicLayer {
  return {
    kind: 'music',
    id: id('mus'),
    z,
    name: 'Music',
    el: createMusic(seed, start),
    ...overrides,
  };
}
