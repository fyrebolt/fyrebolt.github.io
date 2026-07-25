// ===== Sticker model: an image / video overlay placed on the frame =====
//
// A sticker composites a second piece of media (an uploaded image or a second
// video clip) onto the main canvas: it is placed / sized / rotated with the
// shared TransformBox and timed on the shared timeline (start + hold, OUTPUT
// seconds), exactly like the other overlay layers.
//
// The pixels themselves live OUTSIDE this plain-data model — the decoded
// HTMLImageElement / HTMLVideoElement is kept in a media registry keyed by
// `srcId`, so the layer stays serialisable and cheap to snapshot for undo/redo.
//
// A `crop` rectangle (normalised to the sticker's OWN source, 0..1) selects
// which part of the source is visible inside the frame — edited independently of
// the on-canvas placement via the crop-rect editor (the Zoom tool's pattern).
// The placement box is aspect-locked to the crop, so drawing never distorts.
//
// Video stickers loop if their hold outlasts the clip and advance on the main
// WARPED output clock — they slow / freeze together with the main clip's Time
// Machine. Their embedded audio is always muted (sticker audio is a separate,
// procedural appear/disappear SFX feature handled elsewhere).

export type StickerSource = 'image' | 'video';

/** Which part of the source is visible in the frame (source-normalised, 0..1). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export interface StickerElement {
  id: string;
  kind: 'sticker';
  source: StickerSource;
  /** Registry key for the decoded HTMLImageElement / HTMLVideoElement. */
  srcId: string;
  /** Natural source pixel dimensions (for aspect + crop maths). */
  srcW: number;
  srcH: number;
  /** Intrinsic clip length in seconds (video only; 0 for images). */
  clipDur: number;
  /** Placement box on the output frame, normalised to out.w / out.h (top-left + size). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation about the placement-box centre, in radians (clockwise). */
  rotation: number;
  /** Start time on the shared timeline (OUTPUT seconds). */
  start: number;
  /** How long the sticker stays on screen after `start` (OUTPUT seconds). */
  hold: number;
  /** Visible sub-region of the source (source-normalised). */
  crop: CropRect;
}

/** End time of a sticker on the timeline (start + hold). */
export function elementEnd(el: StickerElement): number {
  return el.start + Math.max(0, el.hold);
}

let uid = 0;
function id(): string {
  uid += 1;
  return `stk-${Date.now().toString(36)}-${uid}`;
}

export interface StickerSeed {
  source: StickerSource;
  srcId: string;
  srcW: number;
  srcH: number;
  clipDur: number;
}

/** New sticker, placed centred at a default size, full-frame crop. */
export function createSticker(seed: StickerSeed, overrides: Partial<StickerElement> = {}): StickerElement {
  return {
    kind: 'sticker',
    id: id(),
    source: seed.source,
    srcId: seed.srcId,
    srcW: seed.srcW,
    srcH: seed.srcH,
    clipDur: seed.clipDur,
    x: 0.3,
    y: 0.3,
    w: 0.4,
    h: 0.4,
    rotation: 0,
    start: 0,
    hold: seed.source === 'video' && seed.clipDur > 0 ? Math.min(5, seed.clipDur) : 3,
    crop: { ...FULL_CROP },
    ...overrides,
  };
}
