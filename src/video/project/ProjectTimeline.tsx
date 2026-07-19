// ===== Generalised multi-track timeline: one row per layer, any mix of kinds =====
//
// Ruler + one row per layer. Rows dispatch by kind:
//   - caption (boil):        a draggable range with start/end handles.
//   - caption (typewriter):  a range subdivided typing / hold / (delete) with two
//                            internal dividers.
//   - both carry attachment sub-markers (highlight / underline).
//   - banner:                a bar spanning slide-in → hold → fade-out with a
//                            freeze marker; body-drag moves the freeze point.
//   - zoom:                  the single keyframe track (transition + holding
//                            segments), each keyframe selectable/draggable.

import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Attachment, CaptionEl } from '../captions/types';
import { elementEnd as captionEnd, staticWindowOf } from '../captions/types';
import type { ZoomKeyframe } from '../zoom/types';
import { sortedZooms } from '../zoom/types';
import type { BannerLayer, CaptionLayer, Layer, ZoomLayer } from './types';
import { layerSpan } from './types';

const MIN_DURATION = 0.2;
const MIN_ATTACH_DURATION = 0.2;
const MIN_ZOOM_DURATION = 0.1;

const PHASE_COLORS = { typing: '#6ee7b7', hold: '#93c5fd', del: '#fca5a5' };
const ZOOM_TRANSITION = '#a78bfa';
const ZOOM_HOLDING = 'rgba(167,139,250,0.28)';
const BANNER_COLOR = '#f0883e';

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

interface Props {
  duration: number;
  layers: Layer[]; // display order (row order)
  currentSec: number;
  selectedLayerId: string | null;
  selectedAttachmentId: string | null;
  selectedZoomKfId: string | null;
  onScrub: (sec: number) => void;
  onSelectLayer: (id: string) => void;
  onEditCaption: (layerId: string, patch: Partial<CaptionEl>) => void;
  onSelectAttachment: (layerId: string, attId: string) => void;
  onEditAttachment: (layerId: string, attId: string, patch: Partial<Attachment>) => void;
  onEditBanner: (layerId: string, patch: Partial<BannerLayer>) => void;
  onSelectZoomKf: (layerId: string, kfId: string) => void;
  onEditZoomKf: (layerId: string, kfId: string, patch: Partial<ZoomKeyframe>) => void;
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

export default function ProjectTimeline({
  duration,
  layers,
  currentSec,
  selectedLayerId,
  selectedAttachmentId,
  selectedZoomKfId,
  onScrub,
  onSelectLayer,
  onEditCaption,
  onSelectAttachment,
  onEditAttachment,
  onEditBanner,
  onSelectZoomKf,
  onEditZoomKf,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const capDrag = useRef<CaptionDrag | null>(null);
  const attachDrag = useRef<AttachDrag | null>(null);
  const bannerDrag = useRef<BannerDrag | null>(null);
  const zoomDrag = useRef<ZoomDrag | null>(null);

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

  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / dur) * 100))}%`;
  const playLeft = pct(currentSec);

  // ---- caption row drag ----
  const onCapDown = useCallback(
    (e: ReactPointerEvent, layer: CaptionLayer, mode: CaptionDragMode) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelectLayer(layer.id);
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
        if (d.mode === 'start') onEditCaption(d.layerId, { start: clamp(0, o.end - MIN_DURATION, o.start + delta) });
        else if (d.mode === 'end') onEditCaption(d.layerId, { end: clamp(o.start + MIN_DURATION, dur, o.end + delta) });
        else {
          const len = o.end - o.start;
          const s = clamp(0, dur - len, o.start + delta);
          onEditCaption(d.layerId, { start: s, end: s + len });
        }
        return;
      }
      const del = o.deleteEnabled ? o.deleteDur : 0;
      const total = o.typingDur + o.holdDur + del;
      if (d.mode === 'body' || d.mode === 'start') {
        onEditCaption(d.layerId, { start: clamp(0, dur - total, o.start + delta) });
      } else if (d.mode === 'end') {
        if (o.deleteEnabled) {
          const maxDel = dur - o.start - o.typingDur - o.holdDur;
          onEditCaption(d.layerId, { deleteDur: clamp(MIN_DURATION, maxDel, o.deleteDur + delta) });
        } else {
          const maxHold = dur - o.start - o.typingDur;
          onEditCaption(d.layerId, { holdDur: clamp(MIN_DURATION, maxHold, o.holdDur + delta) });
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
    [dur, fracFromClientX, onEditCaption],
  );

  // ---- attachment drag ----
  const onAttachDown = useCallback(
    (e: ReactPointerEvent, layer: CaptionLayer, att: Attachment, mode: 'move' | 'resize') => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelectAttachment(layer.id, att.id);
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
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelectLayer(layer.id);
      bannerDrag.current = { layerId: layer.id, startX: e.clientX, origFreeze: layer.freeze };
    },
    [onSelectLayer],
  );
  const onBannerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = bannerDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      onEditBanner(d.layerId, { freeze: clamp(0, dur, d.origFreeze + delta) });
    },
    [dur, fracFromClientX, onEditBanner],
  );

  // ---- zoom row drag ----
  const onZoomDown = useCallback(
    (e: ReactPointerEvent, layer: ZoomLayer, kf: ZoomKeyframe, mode: 'start' | 'dur') => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onSelectZoomKf(layer.id, kf.id);
      zoomDrag.current = { layerId: layer.id, kfId: kf.id, mode, startX: e.clientX, orig: kf };
    },
    [onSelectZoomKf],
  );
  const onZoomMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = zoomDrag.current;
      if (!d || e.buttons === 0) return;
      const delta = (fracFromClientX(e.clientX) - fracFromClientX(d.startX)) * dur;
      if (d.mode === 'start') onEditZoomKf(d.layerId, d.kfId, { start: clamp(0, dur - MIN_ZOOM_DURATION, d.orig.start + delta) });
      else onEditZoomKf(d.layerId, d.kfId, { duration: clamp(MIN_ZOOM_DURATION, dur - d.orig.start, d.orig.duration + delta) });
    },
    [dur, fracFromClientX, onEditZoomKf],
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
  }, []);

  return (
    <div className="mt-4 select-none">
      {/* Scrub ruler */}
      <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mb-1 font-mono">
        <span>0:00</span>
        <span>{fmt(currentSec)}</span>
        <span>{fmt(duration)}</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={(e) => onScrub(secFromClientX(e.clientX))}
        className="relative h-6 rounded-md bg-[var(--color-bg-elevated)] cursor-pointer touch-none mb-2"
      >
        <div className="absolute inset-y-0 left-0 rounded-l-md bg-[rgba(116,185,255,0.18)]" style={{ width: playLeft }} />
        <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--color-primary-blue)]" style={{ left: playLeft }} />
      </div>

      <div className="space-y-1.5">
        {layers.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] py-2 text-center">
            No layers yet — use “+ Add layer” to place one on the timeline.
          </div>
        )}

        {layers.map((layer, i) => {
          const selected = layer.id === selectedLayerId;
          const ring = selected ? 'ring-2 ring-[var(--color-primary-green)]' : '';

          if (layer.kind === 'zoom') {
            const sorted = sortedZooms(layer.keyframes);
            return (
              <div key={layer.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)] overflow-hidden">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-30" style={{ left: playLeft }} />
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
                        className={`absolute top-1 bottom-1 rounded-sm flex items-center px-1.5 overflow-hidden cursor-grab active:cursor-grabbing touch-none ${
                          kfSel ? 'ring-2 ring-[var(--color-primary-green)] z-20' : 'z-10'
                        }`}
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

          if (layer.kind === 'banner') {
            const span = layerSpan(layer);
            const leftPct = (span.start / dur) * 100;
            const widthPct = ((span.end - span.start) / dur) * 100;
            const freezePct = (layer.freeze / dur) * 100;
            return (
              <div key={layer.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
                <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
                <div
                  onPointerDown={(e) => onBannerDown(e, layer)}
                  onPointerMove={onBannerMove}
                  onPointerUp={onUp}
                  className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${ring}`}
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
            <div key={layer.id} className="relative h-8 rounded-md bg-[var(--color-bg-elevated)]">
              <div className="absolute top-0 bottom-0 w-px bg-[rgba(116,185,255,0.5)] pointer-events-none z-10" style={{ left: playLeft }} />
              <div
                onPointerDown={(e) => onCapDown(e, layer, 'body')}
                onPointerMove={onCapMove}
                onPointerUp={onUp}
                className={`absolute top-0 bottom-0 rounded-md flex items-center px-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden ${ring}`}
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
  );
}
