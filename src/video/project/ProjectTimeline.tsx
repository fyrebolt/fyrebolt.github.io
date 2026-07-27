// ===== Generalised multi-track timeline: one row per layer, any mix of kinds =====
//
// Ruler, a marker lane, the base clip lane, then one row per layer. Rows dispatch
// by kind:
//   - caption (boil):        a draggable range with start/end handles.
//   - caption (typewriter):  a range subdivided typing / hold / (delete) with two
//                            internal dividers.
//   - both carry attachment sub-markers (highlight / underline).
//   - banner:                a bar spanning slide-in → hold → fade-out with a
//                            freeze marker; body-drag moves the freeze point.
//   - zoom:                  the single keyframe track (transition + holding
//                            segments), each keyframe selectable/draggable.
//
// Every row is drawn for every layer, hidden ones included — the row is how you
// find a hidden layer again. Hidden rows are dimmed; LOCKED rows still select
// (so you can reach the panel and unlock) but refuse every drag: the guard sits
// in the `on*Down` handlers, which are the only way a row edit starts.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Attachment, CaptionEl } from '../captions/types';
import { elementEnd as captionEnd, staticWindowOf } from '../captions/types';
import type { ZoomKeyframe } from '../zoom/types';
import { sortedZooms } from '../zoom/types';
import type { GuideSettings, TimeSnapTarget } from '../transform/snapEngine';
import { snapTime } from '../transform/snapEngine';
import type { Marker } from './markers';
import SpeedCurveRow from './SpeedCurveRow';
import ClipLane from './ClipLane';
import type { ClipExtent } from './ClipLane';
import type { SketchElement } from '../sketch/types';
import type { Highlighter } from '../highlight/types';
import type { DramaticWord } from '../dramatic/types';
import { elementEnd as dramaticEnd } from '../dramatic/types';
import type { StickerElement } from '../sticker/types';
import type { MusicElement } from '../music/types';
import type {
  BannerLayer,
  CaptionLayer,
  DramaticLayer,
  HighlighterLayer,
  Layer,
  MusicLayer,
  SketchLayer,
  StickerLayer,
  ZoomLayer,
} from './types';
import { dramaticSpans, layerSpan } from './types';

const MIN_DURATION = 0.2;
const MIN_ATTACH_DURATION = 0.2;
const MIN_ZOOM_DURATION = 0.1;

const PHASE_COLORS = { typing: '#6ee7b7', hold: '#93c5fd', del: '#fca5a5' };
const ZOOM_TRANSITION = '#a78bfa';
const ZOOM_HOLDING = 'rgba(167,139,250,0.28)';

const BANNER_COLOR = '#f0883e';
const SKETCH_COLOR = '#c4a7fb';
const SKETCH_ANIM = 'rgba(196,167,251,0.45)';
const STICKER_COLOR = '#fbbf77';
const MUSIC_COLOR = '#7ee0d3';

const ROW_COLORS = ['#8be9c7', '#74b9ff', '#ffeaa7', '#ff9ff3', '#ffa07a', '#81ecec'];

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(Math.max(min, max), v));
}

/**
 * Shared opening move for every row drag: select the layer, and report whether
 * the drag may proceed. A locked layer selects but never drags — returning false
 * here (before any capture or drag-ref is set) is what makes the lock airtight
 * across all six drag handlers.
 */
function beginRowDrag(layer: Layer, onSelectLayer: (id: string) => void): boolean {
  onSelectLayer(layer.id);
  return !layer.locked;
}

/** Row chrome for a layer's state: dimmed when hidden, no grab cursor when locked. */
function rowClasses(layer: Layer): string {
  return `${layer.hidden ? 'opacity-40' : ''} ${layer.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`;
}

/** State marker pinned to the right of a row — why it won't drag / won't render. */
function RowBadge({ layer }: { layer: Layer }) {
  if (!layer.locked && !layer.hidden) return null;
  return (
    <span
      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] leading-none z-30"
      title={layer.locked ? 'Locked' : 'Hidden from the output'}
      aria-hidden
    >
      {layer.locked ? '🔒' : '🚫'}
    </span>
  );
}

interface Props {
  duration: number;
  layers: Layer[]; // display order (row order)
  currentSec: number;
  selectedLayerId: string | null;
  selectedAttachmentId: string | null;
  selectedZoomKfId: string | null;
  selectedSpeedIdx: number | null;
  /** Base clips as OUTPUT-time extents, shown as a lane with waveforms. */
  clipExtents: ClipExtent[];
  /** Clip-boundary times (OUTPUT seconds) for temporal snapping. */
  clipEdges: number[];
  selectedClipId: string | null;
  getClipBlob: (srcId: string) => Blob | undefined;
  onSelectClip: (id: string) => void;
  /** Timeline markers: pins in their own lane + a guide line down the whole stack. */
  markers: Marker[];
  selectedMarkerId: string | null;
  onSelectMarker: (id: string) => void;
  /** Streamed while a pin is dragged (the history debounce coalesces the burst). */
  onMoveMarker: (id: string, t: number) => void;
  onRemoveMarker: (id: string) => void;
  /** Double-click on empty lane — a plain click still scrubs. */
  onAddMarkerAt: (t: number) => void;
  /** Guide/snap settings (temporal toggles live here too). */
  guideSettings: GuideSettings;
  onScrub: (sec: number) => void;
  onSelectLayer: (id: string) => void;
  onEditCaption: (layerId: string, patch: Partial<CaptionEl>) => void;
  onSelectAttachment: (layerId: string, attId: string) => void;
  onEditAttachment: (layerId: string, attId: string, patch: Partial<Attachment>) => void;
  onEditBanner: (layerId: string, patch: Partial<BannerLayer>) => void;
  onSelectZoomKf: (layerId: string, kfId: string) => void;
  onEditZoomKf: (layerId: string, kfId: string, patch: Partial<ZoomKeyframe>) => void;
  onSelectSpeedPoint: (layerId: string, idx: number) => void;
  onAddSpeedPoint: (layerId: string, t: number, speed: number) => void;
  onMoveSpeedPoint: (layerId: string, idx: number, t: number, speed: number) => void;
  onRemoveSpeedPoint: (layerId: string, idx: number) => void;
  onEditSketch: (layerId: string, patch: Partial<SketchElement>) => void;
  onEditHighlighter: (layerId: string, patch: Partial<Highlighter>) => void;
  onEditDramatic: (layerId: string, patch: Partial<DramaticWord>) => void;
  onEditSticker: (layerId: string, patch: Partial<StickerElement>) => void;
  onEditMusic: (layerId: string, patch: Partial<MusicElement>) => void;
}

type CaptionDragMode = 'start' | 'end' | 'body' | 'div1' | 'div2';

interface CaptionDrag {
  layerId: string;
  mode: CaptionDragMode;
  startX: number;
  orig: CaptionEl;
}
interface AttachDrag {
  layerId: string;
  attId: string;
  mode: 'move' | 'resize';
  startX: number;
  origStart: number;
  origDuration: number;
  swLen: number;
}
interface BannerDrag {
  layerId: string;
  startX: number;
  origFreeze: number;
}
interface ZoomDrag {
  layerId: string;
  kfId: string;
  mode: 'start' | 'dur';
  startX: number;
  orig: ZoomKeyframe;
}
/** Generic overlay-range drag (sketch / highlighter / dramatic / sticker / music). */
interface RangeDrag {
  layerId: string;
  kind: 'sketch' | 'highlighter' | 'dramatic' | 'sticker' | 'music';
  mode: 'move' | 'end';
  startX: number;
  origStart: number;
  /** The resizable trailing span (sketch: freezeDur, else: duration). */
  origTrail: number;
  /** Fixed span before the trailing edge (sketch: animationDur, else 0). */
  head: number;
  /** Movement bounds in seconds (dramatic clamps to neighbours; others [0, dur]). */
  minStart: number;
  maxStart: number;
  maxTrail: number;
}

export default function ProjectTimeline({
  duration,
  layers,
  currentSec,
  selectedLayerId,
  selectedAttachmentId,
  selectedZoomKfId,
  selectedSpeedIdx,
  clipExtents,
  clipEdges,
  selectedClipId,
  getClipBlob,
  onSelectClip,
  markers,
  selectedMarkerId,
  onSelectMarker,
  onMoveMarker,
  onRemoveMarker,
  onAddMarkerAt,
  guideSettings,
  onScrub,
  onSelectLayer,
  onEditCaption,
  onSelectAttachment,
  onEditAttachment,
  onEditBanner,
  onSelectZoomKf,
  onEditZoomKf,
  onSelectSpeedPoint,
  onAddSpeedPoint,
  onMoveSpeedPoint,
  onRemoveSpeedPoint,
  onEditSketch,
  onEditHighlighter,
  onEditDramatic,
  onEditSticker,
  onEditMusic,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const capDrag = useRef<CaptionDrag | null>(null);
  const attachDrag = useRef<AttachDrag | null>(null);
  const bannerDrag = useRef<BannerDrag | null>(null);
  const zoomDrag = useRef<ZoomDrag | null>(null);
  const rangeDrag = useRef<RangeDrag | null>(null);
  const markerDrag = useRef<{ id: string; startX: number; origT: number } | null>(null);

  // Horizontal zoom is transient VIEW state (not project data): 1 = fit-to-width,
  // higher = more pixels/second with the lane scrolling horizontally.
  const [zoom, setZoom] = useState(1);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);

  const dur = Math.max(0.001, duration);

  const secFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * dur;
    },
    [dur],
  );
  const fracFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }, []);

  // ---- press-drag playhead scrub (ruler + empty row / clip-lane areas) ----
  // Element bodies/handles stopPropagation on pointer-down, so this only fires on
  // bare scrub surface. Raw pointermoves are coalesced to one scrubTo per frame
  // (the Compositor further coalesces the actual <video> seek), so a fast drag
  // lands on the newest frame instead of lagging behind a backlog of seeks.
  const scrubbing = useRef(false);
  const scrubRAF = useRef<number | null>(null);
  const scrubPending = useRef<number | null>(null);

  const flushScrub = useCallback(() => {
    scrubRAF.current = null;
    if (scrubPending.current !== null) {
      onScrub(scrubPending.current);
      scrubPending.current = null;
    }
  }, [onScrub]);

  const onScrubDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return; // primary button only
      scrubbing.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onScrub(secFromClientX(e.clientX));
    },
    [onScrub, secFromClientX],
  );
  const onScrubMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!scrubbing.current || e.buttons === 0) return;
      scrubPending.current = secFromClientX(e.clientX);
      if (scrubRAF.current === null) scrubRAF.current = requestAnimationFrame(flushScrub);
    },
    [secFromClientX, flushScrub],
  );
  const onScrubUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      if (scrubRAF.current !== null) {
        cancelAnimationFrame(scrubRAF.current);
        scrubRAF.current = null;
      }
      if (scrubPending.current !== null) {
        onScrub(scrubPending.current); // land on the final position
        scrubPending.current = null;
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [onScrub],
  );

  useEffect(() => () => {
    if (scrubRAF.current !== null) cancelAnimationFrame(scrubRAF.current);
  }, []);

  // ---- temporal snapping (time-domain twin of the spatial guide locks) ----
  const snapT = useCallback(
    (value: number, exceptLayerId: string | null): number => {
      const el = trackRef.current;
      if (!el) return value;
      const w = el.getBoundingClientRect().width || 1;
      const threshold = (7 / w) * dur; // ~7px pull, expressed in seconds
      const targets: TimeSnapTarget[] = [];
      for (const e of clipEdges) targets.push({ t: e, kind: 'clip' });
      for (const l of layers) {
        if (l.id === exceptLayerId) continue;
        const s = layerSpan(l);
        targets.push({ t: s.start, kind: 'element' }, { t: s.end, kind: 'element' });
      }
      targets.push({ t: currentSec, kind: 'playhead' });
      for (const m of markers) targets.push({ t: m.t, kind: 'marker' });
      const r = snapTime(value, targets, threshold, guideSettings);
      setSnapGuide(r.hit ? r.t : null);
      return r.t;
    },
    [dur, clipEdges, layers, currentSec, markers, guideSettings],
  );

  // Keep the playhead in view as it moves or the zoom changes.
  useEffect(() => {
    const wrap = scrollRef.current;
    if (!wrap || zoom <= 1) return;
    const contentW = wrap.scrollWidth;
    const x = (Math.min(dur, Math.max(0, currentSec)) / dur) * contentW;
    const margin = 24;
    if (x < wrap.scrollLeft + margin) wrap.scrollLeft = Math.max(0, x - margin);
    else if (x > wrap.scrollLeft + wrap.clientWidth - margin) wrap.scrollLeft = x - wrap.clientWidth + margin;
  }, [currentSec, zoom, dur]);

  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / dur) * 100))}%`;
  const playLeft = pct(currentSec);

  // ---- caption row drag ----
  const onCapDown = useCallback(
    (e: ReactPointerEvent, layer: CaptionLayer, mode: CaptionDragMode) => {
      e.stopPropagation();
      if (!beginRowDrag(layer, onSelectLayer)) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      capDrag.current = { layerId: layer.id, mode, startX: e.clientX, orig: layer.el };
    },
    [onSelectLayer],
  );
  const onCapMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = capDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      const o = d.orig;
      if (o.kind === 'boil') {
        if (d.mode === 'start') onEditCaption(d.layerId, { start: clamp(0, o.end - MIN_DURATION, snapT(o.start + delta, d.layerId)) });
        else if (d.mode === 'end') onEditCaption(d.layerId, { end: clamp(o.start + MIN_DURATION, dur, snapT(o.end + delta, d.layerId)) });
        else {
          const len = o.end - o.start;
          const s = clamp(0, dur - len, snapT(o.start + delta, d.layerId));
          onEditCaption(d.layerId, { start: s, end: s + len });
        }
        return;
      }
      const del = o.deleteEnabled ? o.deleteDur : 0;
      const total = o.typingDur + o.holdDur + del;
      if (d.mode === 'body' || d.mode === 'start') {
        onEditCaption(d.layerId, { start: clamp(0, dur - total, snapT(o.start + delta, d.layerId)) });
      } else if (d.mode === 'end') {
        if (o.deleteEnabled) {
          const base = o.start + o.typingDur + o.holdDur;
          const snappedEnd = snapT(base + o.deleteDur + delta, d.layerId);
          const maxDel = dur - base;
          onEditCaption(d.layerId, { deleteDur: clamp(MIN_DURATION, maxDel, snappedEnd - base) });
        } else {
          const base = o.start + o.typingDur;
          const snappedEnd = snapT(base + o.holdDur + delta, d.layerId);
          const maxHold = dur - base;
          onEditCaption(d.layerId, { holdDur: clamp(MIN_DURATION, maxHold, snappedEnd - base) });
        }
      } else if (d.mode === 'div1') {
        const rest = o.holdDur + del;
        const maxT = dur - o.start - rest;
        onEditCaption(d.layerId, { typingDur: clamp(MIN_DURATION, maxT, o.typingDur + delta) });
      } else if (d.mode === 'div2') {
        const maxH = dur - o.start - o.typingDur - del;
        onEditCaption(d.layerId, { holdDur: clamp(MIN_DURATION, maxH, o.holdDur + delta) });
      }
    },
    [dur, fracFromClientX, onEditCaption, snapT],
  );

  // ---- attachment drag ----
  const onAttachDown = useCallback(
    (e: ReactPointerEvent, layer: CaptionLayer, att: Attachment, mode: 'move' | 'resize') => {
      e.stopPropagation();
      onSelectAttachment(layer.id, att.id);
      if (layer.locked) return; // the lock covers the caption's attachments too
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const sw = staticWindowOf(layer.el);
      attachDrag.current = {
        layerId: layer.id,
        attId: att.id,
        mode,
        startX: e.clientX,
        origStart: att.startInStatic,
        origDuration: att.duration,
        swLen: sw ? sw.end - sw.start : att.duration,
      };
    },
    [onSelectAttachment],
  );
  const onAttachMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = attachDrag.current;
      if (!d || e.buttons === 0) return;
      e.stopPropagation();
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'move') {
        const maxStart = Math.max(0, d.swLen - d.origDuration);
        onEditAttachment(d.layerId, d.attId, { startInStatic: clamp(0, maxStart, d.origStart + delta) });
      } else {
        const maxDur = Math.max(MIN_ATTACH_DURATION, d.swLen - d.origStart);
        onEditAttachment(d.layerId, d.attId, { duration: clamp(MIN_ATTACH_DURATION, maxDur, d.origDuration + delta) });
      }
    },
    [dur, fracFromClientX, onEditAttachment],
  );

  // ---- banner row drag (move the freeze point) ----
  const onBannerDown = useCallback(
    (e: ReactPointerEvent, layer: BannerLayer) => {
      e.stopPropagation();
      if (!beginRowDrag(layer, onSelectLayer)) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      bannerDrag.current = { layerId: layer.id, startX: e.clientX, origFreeze: layer.freeze };
    },
    [onSelectLayer],
  );
  const onBannerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = bannerDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      onEditBanner(d.layerId, { freeze: clamp(0, dur, snapT(d.origFreeze + delta, d.layerId)) });
    },
    [dur, fracFromClientX, onEditBanner, snapT],
  );

  // ---- zoom row drag ----
  const onZoomDown = useCallback(
    (e: ReactPointerEvent, layer: ZoomLayer, kf: ZoomKeyframe, mode: 'start' | 'dur') => {
      e.stopPropagation();
      onSelectZoomKf(layer.id, kf.id);
      if (layer.locked) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      zoomDrag.current = { layerId: layer.id, kfId: kf.id, mode, startX: e.clientX, orig: kf };
    },
    [onSelectZoomKf],
  );
  const onZoomMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = zoomDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'start') onEditZoomKf(d.layerId, d.kfId, { start: clamp(0, dur - MIN_ZOOM_DURATION, snapT(d.orig.start + delta, d.layerId)) });
      else onEditZoomKf(d.layerId, d.kfId, { duration: clamp(MIN_ZOOM_DURATION, dur - d.orig.start, d.orig.duration + delta) });
    },
    [dur, fracFromClientX, onEditZoomKf, snapT],
  );

  // ---- generic overlay-range drag (sketch / highlighter / dramatic) ----
  const onRangeDown = useCallback(
    (e: ReactPointerEvent, layer: SketchLayer | HighlighterLayer | DramaticLayer | StickerLayer | MusicLayer, mode: 'move' | 'end') => {
      e.stopPropagation();
      if (!beginRowDrag(layer, onSelectLayer)) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // Sketch resizes trailing FREEZE; sticker resizes HOLD; music resizes DUR;
      // others resize DURATION.
      const origStart = layer.el.start;
      const origTrail =
        layer.kind === 'sketch'
          ? layer.el.freezeDur
          : layer.kind === 'sticker'
            ? layer.el.hold
            : layer.kind === 'music'
              ? layer.el.dur
              : layer.el.duration;
      const head = layer.kind === 'sketch' ? layer.el.animationDur : 0;
      // Dramatic words never overlap: clamp between the nearest neighbours.
      let minStart = 0;
      let maxStart = Math.max(0, dur - head - origTrail);
      let maxTrail = dur;
      if (layer.kind === 'dramatic') {
        const w = layer.el;
        const end = dramaticEnd(w);
        let prevEnd = 0;
        let nextStart = dur;
        for (const s of dramaticSpans(layers, layer.id)) {
          if (s.start <= w.start && s.end <= end) prevEnd = Math.max(prevEnd, s.end);
          if (s.start >= end || s.start > w.start) nextStart = Math.min(nextStart, s.start);
        }
        minStart = prevEnd;
        maxStart = Math.max(prevEnd, nextStart - w.duration);
        maxTrail = Math.max(MIN_DURATION, nextStart - w.start);
      }
      rangeDrag.current = {
        layerId: layer.id,
        kind: layer.kind,
        mode,
        startX: e.clientX,
        origStart,
        origTrail,
        head,
        minStart,
        maxStart,
        maxTrail,
      };
    },
    [dur, layers, onSelectLayer],
  );
  const onRangeMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = rangeDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'move') {
        const start = clamp(d.minStart, d.maxStart, snapT(d.origStart + delta, d.layerId));
        if (d.kind === 'sketch') onEditSketch(d.layerId, { start });
        else if (d.kind === 'highlighter') onEditHighlighter(d.layerId, { start });
        else if (d.kind === 'sticker') onEditSticker(d.layerId, { start });
        else if (d.kind === 'music') onEditMusic(d.layerId, { start });
        else onEditDramatic(d.layerId, { start });
      } else {
        // Resize the trailing span: sketch → freezeDur, sticker → hold, music → dur,
        // others → duration. Snap the trailing END edge, then back to span length.
        const snappedEnd = snapT(d.origStart + d.head + d.origTrail + delta, d.layerId);
        const trail = clamp(MIN_DURATION, d.maxTrail, snappedEnd - d.origStart - d.head);
        if (d.kind === 'sketch') onEditSketch(d.layerId, { freezeDur: trail });
        else if (d.kind === 'highlighter') onEditHighlighter(d.layerId, { duration: trail });
        else if (d.kind === 'sticker') onEditSticker(d.layerId, { hold: trail });
        else if (d.kind === 'music') onEditMusic(d.layerId, { dur: trail });
        else onEditDramatic(d.layerId, { duration: trail });
      }
    },
    [dur, fracFromClientX, onEditSketch, onEditHighlighter, onEditDramatic, onEditSticker, onEditMusic, snapT],
  );

  // ---- marker pin drag (moves the marker along the output clock) ----
  // Markers snap to the same anchors layers do, but with themselves excluded —
  // `exceptLayerId` only filters LAYER anchors, so a pin would otherwise lock to
  // its own position and never move.
  const onMarkerDown = useCallback(
    (e: ReactPointerEvent, m: Marker) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelectMarker(m.id);
      markerDrag.current = { id: m.id, startX: e.clientX, origT: m.t };
    },
    [onSelectMarker],
  );
  const onMarkerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = markerDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      onMoveMarker(d.id, clamp(0, dur, snapT(d.origT + delta, null)));
    },
    [dur, fracFromClientX, onMoveMarker, snapT],
  );

  const onUp = useCallback((e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    capDrag.current = null;
    attachDrag.current = null;
    bannerDrag.current = null;
    zoomDrag.current = null;
    rangeDrag.current = null;
    markerDrag.current = null;
    setSnapGuide(null);
  }, []);

  const contentStyle = { width: `${zoom * 100}%`, minWidth: '100%' } as const;
  const zoomIn = () => setZoom((z) => Math.min(40, +(z * 1.5).toFixed(3)));
  const zoomOut = () => setZoom((z) => Math.max(1, +(z / 1.5).toFixed(3)));

  return (
    <div className="mt-4 select-none">
      {/* header: time readout + horizontal zoom controls */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{fmt(currentSec)} / {fmt(duration)}</span>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} disabled={zoom <= 1} title="Zoom out" className="w-6 h-6 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm leading-none">−</button>
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} disabled={zoom >= 40} title="Zoom in" className="w-6 h-6 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm leading-none">＋</button>
          {zoom > 1 && (
            <button onClick={() => setZoom(1)} title="Fit to width" className="ml-1 px-2 h-6 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-[10px]">Fit</button>
          )}
        </div>
      </div>

      {/* horizontally scrollable timeline body; inner width scales with zoom */}
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
        <div
          style={contentStyle}
          className="relative"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          {/* Scrub ruler (press-drag to scrub is handled by the container) */}
          <div
            ref={trackRef}
            className="relative h-6 rounded-md bg-[var(--color-bg-elevated)] cursor-pointer touch-none mb-1.5"
          >
            <div className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]" style={{ width: playLeft }} />
            <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]" style={{ left: playLeft }} />
          </div>

          {/* marker lane: draggable pins. A plain press still bubbles to the scrub
              container; a DOUBLE-click on empty lane drops a new marker there. */}
          <div
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget) return; // hit a pin, not the lane
              onAddMarkerAt(secFromClientX(e.clientX));
            }}
            title="Double-click to add a marker"
            className="relative h-4 rounded-md bg-[var(--color-bg-elevated)] mb-1.5"
          >
            {markers.map((m) => {
              const sel = m.id === selectedMarkerId;
              return (
                <div
                  key={m.id}
                  onPointerDown={(e) => onMarkerDown(e, m)}
                  onPointerMove={onMarkerMove}
                  onPointerUp={onUp}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onRemoveMarker(m.id);
                  }}
                  title={`${m.label || 'Marker'} · ${m.t.toFixed(2)}s — drag to move, right-click to remove`}
                  className={`absolute top-0 bottom-0 flex items-center pl-1 pr-1.5 rounded-[3px] cursor-grab active:cursor-grabbing touch-none whitespace-nowrap ${
                    sel ? 'ring-1 ring-white z-20' : 'z-10'
                  }`}
                  style={{ left: pct(m.t), background: m.color }}
                >
                  <span className="text-[9px] font-semibold text-black/75 pointer-events-none max-w-[80px] overflow-hidden text-ellipsis">
                    {m.label || '•'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* marker guide lines down the whole stack — what makes a marker usable
              as an alignment reference, not just a bookmark. */}
          {markers.map((m) => (
            <div
              key={m.id}
              className="pointer-events-none absolute top-0 bottom-0 w-px z-20"
              style={{
                left: pct(m.t),
                background: m.color,
                opacity: m.id === selectedMarkerId ? 0.85 : 0.35,
              }}
            />
          ))}

          {/* base clips as a lane (boundaries + waveform) */}
          {clipExtents.length > 0 && (
            <div className="mb-1.5">
              <ClipLane
                extents={clipExtents}
                duration={duration}
                currentSec={currentSec}
                selectedClipId={selectedClipId}
                getClipBlob={getClipBlob}
                onSelectClip={onSelectClip}
              />
            </div>
          )}

          {/* snap guide (a temporal lock line) across the whole stack */}
          {snapGuide !== null && (
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff] z-40" style={{ left: pct(snapGuide) }} />
          )}

      <div className="space-y-1.5">
        {layers.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] py-2 text-center">
            No layers yet — use “+ Add layer” to place one on the timeline.
          </div>
        )}

        {layers.map((layer, i) => {
          const selected = layer.id === selectedLayerId;
          const ring = selected ? 'ring-2 ring-[var(--color-primary-green)]' : '';
          // Shared bar chrome: hidden rows dim, locked rows lose the grab cursor.
          const bar = `absolute top-0 bottom-0 rounded-md flex items-center px-2 touch-none overflow-hidden ${rowClasses(layer)} ${ring}`;

          if (layer.kind === 'zoom') {
            const sorted = sortedZooms(layer.keyframes);
            return (
              <div key={layer.id} className={`relative h-10 rounded-md bg-[var(--color-bg-elevated)] overflow-hidden ${layer.hidden ? 'opacity-40' : ''}`}>
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-30" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                {sorted.length === 0 && (
                  <button
                    onClick={() => onSelectLayer(layer.id)}
                    className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]"
                  >
                    Zoom — add a keyframe
                  </button>
                )}
                {sorted.map((kf, ki) => {
                  const end = kf.start + kf.duration;
                  const nextStart = ki + 1 < sorted.length ? sorted[ki + 1].start : dur;
                  const holdEnd = Math.max(end, nextStart);
                  const startPct = clamp(0, 100, (kf.start / dur) * 100);
                  const transPct = clamp(0, 100 - startPct, (Math.min(kf.duration, dur) / dur) * 100);
                  const holdPct = clamp(0, 100, (Math.max(0, holdEnd - end) / dur) * 100);
                  const kfSel = kf.id === selectedZoomKfId;
                  return (
                    <div key={kf.id}>
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectZoomKf(layer.id, kf.id);
                        }}
                        className="absolute top-2 bottom-2 z-[5] cursor-pointer"
                        style={{ left: `${startPct + transPct}%`, width: `${holdPct}%`, background: ZOOM_HOLDING }}
                        title="Holding at this zoom"
                      />
                      <div
                        onPointerDown={(e) => onZoomDown(e, layer, kf, 'start')}
                        onPointerMove={onZoomMove}
                        onPointerUp={onUp}
                        className={`absolute top-1 bottom-1 rounded-sm flex items-center px-1.5 overflow-hidden touch-none ${
                          layer.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
                        } ${kfSel ? 'ring-2 ring-[var(--color-primary-green)] z-20' : 'z-10'}`}
                        style={{ left: `${startPct}%`, width: `${Math.max(2, transPct)}%`, background: ZOOM_TRANSITION }}
                        title="Drag to move · drag the right edge for the transition time"
                      >
                        <span className="text-[9px] font-bold text-black/70 pointer-events-none whitespace-nowrap">⤢{ki + 1}</span>
                        <div
                          onPointerDown={(e) => onZoomDown(e, layer, kf, 'dur')}
                          onPointerMove={onZoomMove}
                          onPointerUp={onUp}
                          className="absolute right-0 top-0 bottom-0 w-1.5 bg-black/40 hover:bg-black/70 cursor-ew-resize touch-none"
                        />
                      </div>
                      <div className="absolute top-0 bottom-0 w-[2px] bg-white/80 pointer-events-none z-20" style={{ left: `${startPct}%` }} />
                    </div>
                  );
                })}
              </div>
            );
          }

          if (layer.kind === 'timemachine') {
            return (
              <SpeedCurveRow
                key={layer.id}
                points={layer.points}
                duration={dur}
                currentSec={currentSec}
                selected={selected}
                selectedIdx={selectedSpeedIdx}
                locked={layer.locked}
                hidden={layer.hidden}
                onSelectLayer={() => onSelectLayer(layer.id)}
                onAddPoint={(t, speed) => onAddSpeedPoint(layer.id, t, speed)}
                onMovePoint={(idx, t, speed) => onMoveSpeedPoint(layer.id, idx, t, speed)}
                onRemovePoint={(idx) => onRemoveSpeedPoint(layer.id, idx)}
                onSelectPoint={(idx) => onSelectSpeedPoint(layer.id, idx)}
              />
            );
          }

          if (layer.kind === 'banner') {
            const span = layerSpan(layer);
            const leftPct = (span.start / dur) * 100;
            const widthPct = ((span.end - span.start) / dur) * 100;
            const freezePct = (layer.freeze / dur) * 100;
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onBannerDown(e, layer)}
                  onPointerMove={onBannerMove}
                  onPointerUp={onUp}
                  className={bar}
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: BANNER_COLOR }}
                  title="Drag to move the freeze point"
                >
                  <span className="text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">⚔️ {layer.name}</span>
                </div>
                {/* freeze marker */}
                <div
                  className="absolute top-0 bottom-0 flex flex-col items-center -translate-x-1/2 pointer-events-none z-20"
                  style={{ left: `${Math.min(100, Math.max(0, freezePct))}%` }}
                >
                  <div className="w-[3px] h-full bg-[var(--color-primary-green)]" />
                </div>
              </div>
            );
          }

          if (layer.kind === 'sketch') {
            const span = layerSpan(layer);
            const leftPct = (span.start / dur) * 100;
            const widthPct = ((span.end - span.start) / dur) * 100;
            const total = Math.max(0.001, span.end - span.start);
            const animF = layer.el.animationDur / total;
            const label = layer.el.strokes.length === 0 ? 'empty sketch' : layer.name;
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onRangeDown(e, layer, 'move')}
                  onPointerMove={onRangeMove}
                  onPointerUp={onUp}
                  className={bar}
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: SKETCH_COLOR }}
                  title="Drag to move · drag the right edge for the freeze time"
                >
                  {layer.el.animationDur > 0 && (
                    <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${animF * 100}%`, background: SKETCH_ANIM }} />
                  )}
                  <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">✏️ {label}</span>
                  <div onPointerDown={(e) => onRangeDown(e, layer, 'end')} onPointerMove={onRangeMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                </div>
              </div>
            );
          }

          if (layer.kind === 'highlighter') {
            const h = layer.el;
            const leftPct = (h.start / dur) * 100;
            const widthPct = (h.duration / dur) * 100;
            const inF = Math.max(0, Math.min(1, h.sweepIn / Math.max(0.001, h.duration)));
            const outF = Math.max(0, Math.min(1, h.sweepOut / Math.max(0.001, h.duration)));
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onRangeDown(e, layer, 'move')}
                  onPointerMove={onRangeMove}
                  onPointerUp={onUp}
                  className={bar}
                  // Inline opacity would beat the dim class, so fold `hidden` into it.
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: h.color, opacity: layer.hidden ? 0.34 : 0.85 }}
                  title="Drag to move · drag the right edge for the duration"
                >
                  <div className="absolute inset-y-0 left-0 pointer-events-none bg-white/45" style={{ width: `${inF * 100}%` }} />
                  <div className="absolute inset-y-0 right-0 pointer-events-none bg-black/30" style={{ width: `${outF * 100}%` }} />
                  <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">🖍️ {layer.name}</span>
                  <div onPointerDown={(e) => onRangeDown(e, layer, 'end')} onPointerMove={onRangeMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                </div>
              </div>
            );
          }

          if (layer.kind === 'dramatic') {
            const w = layer.el;
            const leftPct = (w.start / dur) * 100;
            const widthPct = (w.duration / dur) * 100;
            const inF = Math.max(0, Math.min(1, w.fadeIn / Math.max(0.001, w.duration)));
            const outF = Math.max(0, Math.min(1, w.fadeOut / Math.max(0.001, w.duration)));
            const bg = w.mode === 'inverse' ? '#6b7280' : w.mode === 'reflection' ? '#c084fc' : '#a3bffa';
            const glyph = w.mode === 'inverse' ? '◱' : w.mode === 'reflection' ? '🔃' : '▤';
            const label = (w.text || 'word').toUpperCase();
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onRangeDown(e, layer, 'move')}
                  onPointerMove={onRangeMove}
                  onPointerUp={onUp}
                  className={bar}
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: bg }}
                  title="Drag to move (clamped between neighbours) · drag the right edge for the hold"
                >
                  <div className="absolute inset-y-0 left-0 pointer-events-none bg-white/40" style={{ width: `${inF * 100}%` }} />
                  <div className="absolute inset-y-0 right-0 pointer-events-none bg-black/25" style={{ width: `${outF * 100}%` }} />
                  <span className="relative text-[10px] font-bold text-black/75 whitespace-nowrap truncate pointer-events-none">{glyph} {label}</span>
                  <div onPointerDown={(e) => onRangeDown(e, layer, 'end')} onPointerMove={onRangeMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                </div>
              </div>
            );
          }

          if (layer.kind === 'sticker') {
            const s = layer.el;
            const leftPct = (s.start / dur) * 100;
            const widthPct = (s.hold / dur) * 100;
            const glyph = s.source === 'video' ? '🎬' : '🖼️';
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onRangeDown(e, layer, 'move')}
                  onPointerMove={onRangeMove}
                  onPointerUp={onUp}
                  className={bar}
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: STICKER_COLOR }}
                  title="Drag to move · drag the right edge for the hold time"
                >
                  <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">{glyph} {layer.name}</span>
                  <div onPointerDown={(e) => onRangeDown(e, layer, 'end')} onPointerMove={onRangeMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                </div>
              </div>
            );
          }

          if (layer.kind === 'music') {
            const m = layer.el;
            const leftPct = (m.start / dur) * 100;
            const widthPct = (m.dur / dur) * 100;
            return (
              <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
                <div
                  onPointerDown={(e) => onRangeDown(e, layer, 'move')}
                  onPointerMove={onRangeMove}
                  onPointerUp={onUp}
                  className={bar}
                  style={{ left: `${leftPct}%`, width: `${Math.max(2, widthPct)}%`, background: MUSIC_COLOR }}
                  title="Drag to move · drag the right edge for the track length"
                >
                  <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                    🎵 {m.loop ? '↻ ' : ''}{layer.name}
                  </span>
                  <div onPointerDown={(e) => onRangeDown(e, layer, 'end')} onPointerMove={onRangeMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                </div>
              </div>
            );
          }

          // caption (boil | typewriter)
          const el = layer.el;
          const start = el.start;
          const end = captionEnd(el);
          const leftPct = (start / dur) * 100;
          const widthPct = ((end - start) / dur) * 100;
          const label = el.text.split('\n')[0] || (el.kind === 'typewriter' ? 'typewriter' : 'caption');
          const sw = staticWindowOf(el);
          const total = Math.max(0.001, end - start);
          const typingF = el.kind === 'typewriter' ? el.typingDur / total : 0;
          const holdF = el.kind === 'typewriter' ? el.holdDur / total : 0;
          const div1Left = `${typingF * 100}%`;
          const div2Left = `${(typingF + holdF) * 100}%`;
          const rowColor = ROW_COLORS[i % ROW_COLORS.length];

          return (
            <div key={layer.id} className="relative h-10 rounded-md bg-[var(--color-bg-elevated)]">
              <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <RowBadge layer={layer} />
              <div
                onPointerDown={(e) => onCapDown(e, layer, 'body')}
                onPointerMove={onCapMove}
                onPointerUp={onUp}
                className={bar}
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(1.5, widthPct)}%`,
                  background: el.kind === 'typewriter' ? 'transparent' : rowColor,
                }}
              >
                {el.kind === 'typewriter' && (
                  <>
                    <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: div1Left, background: PHASE_COLORS.typing }} />
                    <div className="absolute inset-y-0 pointer-events-none" style={{ left: div1Left, width: `${holdF * 100}%`, background: PHASE_COLORS.hold }} />
                    {el.deleteEnabled && (
                      <div className="absolute inset-y-0 right-0 pointer-events-none" style={{ left: div2Left, background: PHASE_COLORS.del }} />
                    )}
                  </>
                )}
                <span className="relative text-[10px] font-medium text-black/80 whitespace-nowrap truncate pointer-events-none">
                  {el.kind === 'typewriter' ? `⌨ ${label}` : label}
                </span>
                <div onPointerDown={(e) => onCapDown(e, layer, 'start')} onPointerMove={onCapMove} onPointerUp={onUp} className="absolute left-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-l-md touch-none z-20" />
                <div onPointerDown={(e) => onCapDown(e, layer, 'end')} onPointerMove={onCapMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-md touch-none z-20" />
                {el.kind === 'typewriter' && (
                  <>
                    <div onPointerDown={(e) => onCapDown(e, layer, 'div1')} onPointerMove={onCapMove} onPointerUp={onUp} className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-black/50 hover:bg-black/80 cursor-ew-resize touch-none z-20" style={{ left: div1Left }} />
                    {el.deleteEnabled && (
                      <div onPointerDown={(e) => onCapDown(e, layer, 'div2')} onPointerMove={onCapMove} onPointerUp={onUp} className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-black/50 hover:bg-black/80 cursor-ew-resize touch-none z-20" style={{ left: div2Left }} />
                    )}
                  </>
                )}
              </div>

              {sw &&
                el.attachments.map((att) => {
                  const absStart = sw.start + att.startInStatic;
                  const absEnd = Math.min(sw.end, absStart + att.duration);
                  const aLeft = (absStart / dur) * 100;
                  const aWidth = Math.max(0.8, ((absEnd - absStart) / dur) * 100);
                  const attSel = att.id === selectedAttachmentId;
                  return (
                    <div
                      key={att.id}
                      onPointerDown={(e) => onAttachDown(e, layer, att, 'move')}
                      onPointerMove={onAttachMove}
                      onPointerUp={onUp}
                      title={`${att.type} · words ${Math.min(att.wordStart, att.wordEnd) + 1}–${Math.max(att.wordStart, att.wordEnd) + 1}`}
                      className={`absolute bottom-[2px] h-2.5 rounded-[3px] cursor-grab active:cursor-grabbing touch-none z-30 ${attSel ? 'ring-2 ring-white' : 'ring-1 ring-black/40'}`}
                      style={{ left: `${aLeft}%`, width: `${aWidth}%`, background: att.color, opacity: att.type === 'highlight' ? 0.7 : 1 }}
                    >
                      {att.type === 'underline' && <span className="absolute inset-x-0 bottom-[1px] h-[2px] bg-black/50 rounded-full pointer-events-none" />}
                      <div onPointerDown={(e) => onAttachDown(e, layer, att, 'resize')} onPointerMove={onAttachMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-1.5 bg-black/40 hover:bg-black/70 cursor-ew-resize rounded-r-[3px] touch-none z-40" />
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
        </div>
      </div>
    </div>
  );
}
