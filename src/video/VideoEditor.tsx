import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import IpadFrame from '../ios/IpadFrame';
import { Compositor } from './project/Compositor';
import type { LoadedMedia } from './project/Compositor';
import ProjectTimeline from './project/ProjectTimeline';
import ZoomRectEditor from './zoom/ZoomRectEditor';
import TransformBox from './transform/TransformBox';
import type { Transform } from './transform/TransformBox';
import type { Box, GuideSettings, Guide } from './transform/snapEngine';
import { DEFAULT_GUIDES, snapMove } from './transform/snapEngine';
import { measurePlaceableBox } from './transform/measure';
import { outputSizeFor } from './render';
import { transcodeToMp4, ensureFFmpeg } from './ffmpeg';
import { preloadAllFontPools, FONT_POOLS } from './captions/fonts';
import type { BoilPoolId } from './captions/fonts';
import { createAttachment, staticWindowOf } from './captions/types';
import type { Attachment, AttachmentType, Caption, CaptionEl, TypewriterCaption } from './captions/types';
import { createZoom } from './zoom/types';
import type { ZoomKeyframe, ZoomRect } from './zoom/types';
import { createSpeed } from './timemachine/types';
import type { SpeedKeyframe } from './timemachine/types';
import type { SketchElement, SketchStroke } from './sketch/types';
import type { Highlighter } from './highlight/types';
import { createDramaticWord } from './dramatic/types';
import type { DramaticWord, WordMode } from './dramatic/types';
import type { FillMode, RatioKey, BannerStyle } from './types';
import type {
  BannerLayer,
  CaptionLayer,
  DramaticLayer,
  HighlighterLayer,
  Layer,
  Project,
  SketchLayer,
  Span,
  StickerLayer,
  TimeMachineLayer,
  ZoomLayer,
} from './project/types';
import {
  bannerLayer,
  zoomLayer,
  timeMachineLayer,
  overlayLayers,
  layerSpan,
  dramaticSpans,
  nextZ,
  createBannerLayer,
  createCaptionLayer,
  createZoomLayer,
  createTimeMachineLayer,
  createSketchLayer,
  createHighlighterLayer,
  createDramaticLayer,
  createStickerLayer,
} from './project/types';
import type { StickerElement } from './sticker/types';
import { compileWarp } from './project/timeMap';
import { Panel, Field, ChoiceGrid } from './project/ui';
import { RATIO_LABELS, FILL_MODES } from './project/constants';
import CaptionPanel from './project/panels/CaptionPanel';
import BannerPanel from './project/panels/BannerPanel';
import ZoomPanel from './project/panels/ZoomPanel';
import TimeMachinePanel from './project/panels/TimeMachinePanel';
import SketchPanel from './project/panels/SketchPanel';
import type { Pen } from './project/panels/SketchPanel';
import HighlighterPanel from './project/panels/HighlighterPanel';
import DramaticPanel from './project/panels/DramaticPanel';
import StickerPanel from './project/panels/StickerPanel';
import StickerCropEditor from './sticker/StickerCropEditor';
import { useHistory } from './project/useHistory';
import type { HistoryApi } from './project/useHistory';

/** First non-overlapping gap of ≥0.6s among dramatic layers, else null. */
function findDramaticGap(spans: Span[], total: number, want: number): { start: number; duration: number } | null {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const s of sorted) {
    const gap = s.start - cursor;
    if (gap >= 0.6) return { start: cursor, duration: Math.min(want, gap) };
    cursor = Math.max(cursor, s.end);
  }
  const tail = total - cursor;
  if (tail >= 0.6) return { start: cursor, duration: Math.min(want, tail) };
  return null;
}

type MediaKind = 'video' | 'image' | null;
type ExportStage = 'idle' | 'recording' | 'preparing' | 'encoding' | 'done' | 'error';

/** One immutable snapshot of the whole project, for the undo/redo history. */
interface EditorSnapshot {
  layers: Layer[];
  ratio: RatioKey;
  fillMode: FillMode;
  boilPool: BoilPoolId;
  normalize: boolean;
  sfxEnabled: boolean;
  sfxVolume: number;
  imageDuration: number;
  pen: Pen;
}

/** Layers that carry a free on-canvas placement (box or anchored text). */
type PlaceableLayer = SketchLayer | HighlighterLayer | CaptionLayer | DramaticLayer | StickerLayer;
function isPlaceable(l: Layer | null | undefined): l is PlaceableLayer {
  return (
    !!l &&
    (l.kind === 'sketch' || l.kind === 'highlighter' || l.kind === 'caption' || l.kind === 'dramatic' || l.kind === 'sticker')
  );
}
function rotationOf(l: PlaceableLayer): number {
  return l.el.rotation;
}

const GUIDE_TOGGLES: { key: keyof GuideSettings; label: string }[] = [
  { key: 'centerH', label: 'Centre horizontally' },
  { key: 'centerV', label: 'Centre vertically' },
  { key: 'fitWidth', label: 'Fit to width' },
  { key: 'fitHeight', label: 'Fit to height' },
  { key: 'border', label: 'Snap to borders' },
  { key: 'object', label: 'Snap to objects' },
  { key: 'cursor', label: 'Snap to cursor' },
];

const GUIDES_OFF: GuideSettings = {
  centerH: false,
  centerV: false,
  fitWidth: false,
  fitHeight: false,
  border: false,
  object: false,
  cursor: false,
};

type AddKind =
  | 'banner'
  | 'boil'
  | 'typewriter'
  | 'zoom'
  | 'timemachine'
  | 'sketch'
  | 'highlighter'
  | 'dramatic-normal'
  | 'dramatic-inverse'
  | 'dramatic-reflection'
  | 'sticker-image'
  | 'sticker-video';

const ADD_ITEMS: { kind: AddKind; label: string; icon: string }[] = [
  { kind: 'banner', label: 'Entrance Banner', icon: '⚔️' },
  { kind: 'boil', label: 'Caption', icon: '💬' },
  { kind: 'typewriter', label: 'Typewriter', icon: '⌨️' },
  { kind: 'zoom', label: 'Zoom', icon: '🔍' },
  { kind: 'timemachine', label: 'Time Machine', icon: '⏱️' },
  { kind: 'sketch', label: 'Sketch', icon: '✏️' },
  { kind: 'highlighter', label: 'Highlighter', icon: '🖍️' },
  { kind: 'sticker-image', label: 'Image sticker', icon: '🖼️' },
  { kind: 'sticker-video', label: 'Video sticker', icon: '🎬' },
  { kind: 'dramatic-normal', label: 'Dramatic word', icon: '🔠' },
  { kind: 'dramatic-inverse', label: 'Inverse word', icon: '◱' },
  { kind: 'dramatic-reflection', label: 'Reflection word', icon: '🔃' },
];

/** Frozen-hold length for the "+ Freeze" preset (output seconds). */
const FREEZE_BLOCK_HOLD = 1.2;
/** Near-instant ramp used by the freeze block's snap-to-0 and resume keyframes. */
const FREEZE_SNAP_RAMP = 0.12;

export default function VideoEditor() {
  // ---- media ----
  const [mediaKind, setMediaKind] = useState<MediaKind>(null);
  const [duration, setDuration] = useState(0); // clip seconds (0 for image)
  const [currentSec, setCurrentSec] = useState(0); // OUTPUT seconds
  const [srcDims, setSrcDims] = useState({ w: 0, h: 0 });

  // ---- project ----
  const [layers, setLayers] = useState<Layer[]>([]);
  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [boilPool, setBoilPool] = useState<BoilPoolId>('default');
  const [normalize, setNormalize] = useState(true);
  const [sfxEnabled, setSfxEnabled] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.5);
  const [imageDuration, setImageDuration] = useState(6);

  // Drawing-pad pen (shared tool state for sketch layers).
  const [pen, setPen] = useState<Pen>({ color: '#ff4d4d', width: 0.02, smoothness: 0.8 });

  // ---- selection / editing ----
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  /** Extra placeable ids co-selected for group move (raw; includes the primary). */
  const [groupIds, setGroupIds] = useState<string[]>([]);
  /** Marquee rect (output-normalised) while drag-selecting, else null. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedZoomKfId, setSelectedZoomKfId] = useState<string | null>(null);
  const [selectedSpeedKfId, setSelectedSpeedKfId] = useState<string | null>(null);
  const [editingZoom, setEditingZoom] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // ---- ui ----
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [guidesOn, setGuidesOn] = useState(true);
  const [guideSettings, setGuideSettings] = useState<GuideSettings>(DEFAULT_GUIDES);
  const [gearOpen, setGearOpen] = useState(false);
  const [guideLines, setGuideLines] = useState<Guide[]>([]);

  // ---- undo / redo history (stable wrappers; the engine is created below) ----
  const historyRef = useRef<HistoryApi | null>(null);
  const sealDiscrete = useCallback(() => historyRef.current?.sealDiscrete(), []);
  const undo = useCallback(() => historyRef.current?.undo(), []);
  const redo = useCallback(() => historyRef.current?.redo(), []);
  /** Layer id pending a delete confirmation, else null. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ---- export ----
  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add layers with “+”.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('camera.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const projectRef = useRef<Project>({ layers: [], ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration });
  const objectUrls = useRef<string[]>([]);
  /** Decoded sticker media (image / video), kept out of the project so layers stay plain data. */
  const stickerMedia = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map());
  /** Hidden file inputs used to pick sticker media on demand. */
  const stickerImageInput = useRef<HTMLInputElement>(null);
  const stickerVideoInput = useRef<HTMLInputElement>(null);
  /** Sticker layer currently in crop mode (double-clicked), else null. */
  const [croppingId, setCroppingId] = useState<string | null>(null);
  /** Size/rotation reference captured when a text-layer transform grab starts. */
  const textGrab = useRef<{ id: string; sizeScale: number; w: number } | null>(null);
  /** Group-move gesture: ids + each layer's origin (x,y) captured at grab. */
  const groupDrag = useRef<{ startN: { x: number; y: number }; items: { id: string; x: number; y: number }[] } | null>(null);
  /** Marquee gesture origin (normalised), else null. */
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const editingRef = useRef(false);

  const project: Project = useMemo(
    () => ({ layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration }),
    [layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration],
  );

  const banner = bannerLayer(project);
  const zoom = zoomLayer(project);
  const timeMachine = timeMachineLayer(project);
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null;

  // Output (paint bottom→top) + a display order for the list/timeline (front first).
  // Zoom + Time Machine are base tracks — they sit at the bottom of the stack.
  const displayLayers = useMemo(() => {
    const overlays = overlayLayers(project).slice().reverse(); // front first
    const bases = project.layers.filter((l) => l.kind === 'zoom' || l.kind === 'timemachine');
    return [...overlays, ...bases];
  }, [project]);

  // Timeline / output duration (seconds). For video this is the warped output
  // length (speed track + banner freeze can stretch or shrink it).
  const timelineDuration = useMemo(() => {
    if (mediaKind === 'video') return Math.max(0.1, compileWarp(project, duration).totalOutput);
    const ends = layers.map((l) => layerSpan(l).end);
    return Math.max(3, imageDuration, ...ends);
  }, [project, mediaKind, duration, layers, imageDuration]);

  // Preload fonts up front so switching pools / drawing never falls back.
  useEffect(() => {
    preloadAllFontPools().then(() => compRef.current?.renderStatic());
  }, []);

  // Keep the compositor's project source current + redraw on edits.
  useEffect(() => {
    projectRef.current = project;
    const c = compRef.current;
    if (!c) return;
    if (editingRef.current) c.redrawEditZoom();
    else c.renderStatic();
  }, [project]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const c = new Compositor(
      canvasRef.current,
      () => projectRef.current,
      (sec) => setCurrentSec(sec),
      (srcId) => stickerMedia.current.get(srcId),
    );
    compRef.current = c;
    return () => {
      c.destroy();
      compRef.current = null;
    };
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // ---- keyboard: undo / redo + delete the selected layer ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmDeleteId) return; // the delete-confirm dialog owns the keyboard
      const t = e.target as HTMLElement | null;
      const editable =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape' && croppingId) {
        e.preventDefault();
        setCroppingId(null);
        return;
      }

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (editable) return; // let native text-undo win inside form fields
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (editable) return;
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editable && selectedLayerId) {
        e.preventDefault();
        setConfirmDeleteId(selectedLayerId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedLayerId, confirmDeleteId, croppingId]);

  const setEditingZoomBoth = (v: boolean) => {
    editingRef.current = v;
    setEditingZoom(v);
  };

  // ---- undo / redo engine (whole-project snapshots) ----
  const snapshot: EditorSnapshot = useMemo(
    () => ({ layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, pen }),
    [layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, pen],
  );
  const restoreSnapshot = useCallback((s: EditorSnapshot) => {
    setLayers(s.layers);
    setRatio(s.ratio);
    setFillMode(s.fillMode);
    setBoilPool(s.boilPool);
    setNormalize(s.normalize);
    setSfxEnabled(s.sfxEnabled);
    setSfxVolume(s.sfxVolume);
    setImageDuration(s.imageDuration);
    setPen(s.pen);
    // Reset transient editing state and clamp selection to layers that survive.
    editingRef.current = false;
    setEditingZoom(false);
    setSelectedZoomKfId(null);
    setSelectedSpeedKfId(null);
    compRef.current?.exitEdit();
    setSelectedAttachmentId(null);
    setGroupIds((g) => g.filter((id) => s.layers.some((l) => l.id === id)));
    setSelectedLayerId((cur) => (cur && s.layers.some((l) => l.id === cur) ? cur : null));
    setCroppingId((cur) => (cur && s.layers.some((l) => l.id === cur) ? cur : null));
  }, []);
  const snapshotEqual = useCallback(
    (a: EditorSnapshot, b: EditorSnapshot) =>
      a.layers === b.layers &&
      a.ratio === b.ratio &&
      a.fillMode === b.fillMode &&
      a.boilPool === b.boilPool &&
      a.normalize === b.normalize &&
      a.sfxEnabled === b.sfxEnabled &&
      a.sfxVolume === b.sfxVolume &&
      a.imageDuration === b.imageDuration &&
      a.pen === b.pen,
    [],
  );
  const history = useHistory<EditorSnapshot>({ live: snapshot, restore: restoreSnapshot, equal: snapshotEqual });
  historyRef.current = history;

  // ---- media load ----
  const onFile = useCallback((file: File) => {
    const c = compRef.current;
    if (!c) return;
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    setDownloadUrl(null);
    setStage('idle');
    setProgress(0);

    if (file.type.startsWith('video')) {
      const video = document.createElement('video');
      video.src = url;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.addEventListener('loadedmetadata', () => {
        setMediaKind('video');
        setDuration(video.duration);
        setSrcDims({ w: video.videoWidth, h: video.videoHeight });
        const media: LoadedMedia = { kind: 'video', video, duration: video.duration };
        c.attach(media);
        setStatus('Loaded. Add layers with “+”, then Export when ready.');
      });
    } else if (file.type.startsWith('image')) {
      const image = new Image();
      image.onload = () => {
        setMediaKind('image');
        setDuration(0);
        setSrcDims({ w: image.naturalWidth, h: image.naturalHeight });
        const media: LoadedMedia = { kind: 'image', image, duration: 0 };
        c.attach(media);
        setStatus('Photo loaded. Add layers with “+”.');
      };
      image.src = url;
    }
  }, []);

  // ---- seeking ----
  const seekTo = useCallback((sec: number) => {
    compRef.current?.scrubTo(sec);
    setCurrentSec(sec);
  }, []);

  const midOfCaption = useCallback((el: CaptionEl): number => {
    if (el.kind === 'boil') return (el.start + el.end) / 2;
    return el.start + el.typingDur + Math.min(0.3, el.holdDur / 2);
  }, []);

  // A moment mid-hold so the preview shows the banner locked without the flash.
  const bannerPreviewTime = useCallback((b: BannerLayer): number => b.freeze + Math.min(0.5, b.hold * 0.5), []);

  // ---- add layers ----
  const staggerStart = useCallback(() => {
    const total = mediaKind === 'video' ? timelineDuration : Math.max(timelineDuration, 4);
    const prevEnd = layers.reduce((m, l) => Math.max(m, layerSpan(l).end), 0);
    return Math.min(prevEnd, Math.max(0, total - 0.5));
  }, [layers, mediaKind, timelineDuration]);

  const clearZoomEdit = useCallback(() => {
    setEditingZoomBoth(false);
    setSelectedZoomKfId(null);
    compRef.current?.exitEdit();
  }, []);

  const addLayer = useCallback(
    (kind: AddKind) => {
      setAddOpen(false);
      if (!mediaKind) return;
      // Stickers need media first — open the picker; the layer is created on select.
      if (kind === 'sticker-image') {
        stickerImageInput.current?.click();
        return;
      }
      if (kind === 'sticker-video') {
        stickerVideoInput.current?.click();
        return;
      }
      sealDiscrete();
      const z = nextZ(projectRef.current);
      const outSize = srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : outputSizeFor(ratio, 1080, 1920);
      const outAR = outSize.w / outSize.h;

      if (kind === 'banner') {
        if (bannerLayer(projectRef.current)) return;
        const freeze = mediaKind === 'video' ? Math.min(duration * 0.33, Math.max(0, duration - 0.2)) : 1.5;
        const layer = createBannerLayer(z, { freeze });
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        seekTo(bannerPreviewTime(layer));
        return;
      }
      if (kind === 'zoom') {
        if (zoomLayer(projectRef.current)) return;
        const layer = createZoomLayer(z);
        setLayers((ls) => [...ls, layer]);
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setSelectedZoomKfId(null);
        return;
      }
      if (kind === 'timemachine') {
        // Video-only singleton (a still image has no playback speed to warp).
        if (mediaKind !== 'video' || timeMachineLayer(projectRef.current)) return;
        const layer = createTimeMachineLayer(z);
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setSelectedSpeedKfId(null);
        return;
      }
      if (kind === 'sketch') {
        // Empty sketch, placed full-frame; draw strokes in the panel, then place it.
        const layer = createSketchLayer(z, outAR, {});
        layer.el.start = staggerStart();
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        seekTo(layer.el.start + Math.min(0.3, layer.el.freezeDur / 2));
        return;
      }
      if (kind === 'highlighter') {
        const layer = createHighlighterLayer(z);
        layer.el.start = staggerStart();
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        seekTo(layer.el.start + Math.min(0.5, layer.el.duration / 2));
        return;
      }
      if (kind === 'dramatic-normal' || kind === 'dramatic-inverse' || kind === 'dramatic-reflection') {
        const mode: WordMode =
          kind === 'dramatic-inverse' ? 'inverse' : kind === 'dramatic-reflection' ? 'reflection' : 'normal';
        // Words never overlap in time — drop the new one into the first free gap.
        const gap = findDramaticGap(dramaticSpans(projectRef.current.layers), timelineDuration, 2);
        if (!gap) {
          setStatus('No free space on the timeline for another word — shorten or remove one first.');
          return;
        }
        const word = createDramaticWord({ mode, start: gap.start, duration: gap.duration });
        const layer = createDramaticLayer(z, mode, word);
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        seekTo(word.start + Math.min(0.5, word.duration / 2));
        return;
      }
      // caption / typewriter
      const start = staggerStart();
      const layer = createCaptionLayer(kind === 'boil' ? 'boil' : 'typewriter', z);
      layer.el.start = start;
      layer.el.x = 0.5;
      layer.el.y = 0.72;
      if (layer.el.kind === 'boil') layer.el.end = start + 2;
      setLayers((ls) => [...ls, layer]);
      clearZoomEdit();
      setSelectedLayerId(layer.id);
      setSelectedAttachmentId(null);
      seekTo(midOfCaption(layer.el));
    },
    [mediaKind, duration, ratio, srcDims, timelineDuration, staggerStart, clearZoomEdit, seekTo, midOfCaption, bannerPreviewTime, sealDiscrete],
  );

  /** Fit a source-aspect box into ~40% of the frame, centred (out-normalised). */
  const fitStickerBox = useCallback(
    (srcW: number, srcH: number) => {
      const outSize = srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : outputSizeFor(ratio, 1080, 1920);
      const aspect = srcH > 0 ? srcW / srcH : 1;
      let wPx = 0.4 * outSize.w;
      let hPx = wPx / aspect;
      if (hPx > 0.4 * outSize.h) {
        hPx = 0.4 * outSize.h;
        wPx = hPx * aspect;
      }
      const w = wPx / outSize.w;
      const h = hPx / outSize.h;
      return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
    },
    [ratio, srcDims.w, srcDims.h],
  );

  /** Register decoded sticker media and add its layer, placed + timed. */
  const addStickerLayer = useCallback(
    (source: 'image' | 'video', srcId: string, srcW: number, srcH: number, clipDur: number) => {
      sealDiscrete();
      const z = nextZ(projectRef.current);
      const layer = createStickerLayer(z, { source, srcId, srcW, srcH, clipDur });
      const box = fitStickerBox(srcW, srcH);
      layer.el.x = box.x;
      layer.el.y = box.y;
      layer.el.w = box.w;
      layer.el.h = box.h;
      layer.el.start = staggerStart();
      setLayers((ls) => [...ls, layer]);
      clearZoomEdit();
      setSelectedLayerId(layer.id);
      setSelectedAttachmentId(null);
      seekTo(layer.el.start + Math.min(0.5, layer.el.hold / 2));
    },
    [sealDiscrete, fitStickerBox, staggerStart, clearZoomEdit, seekTo],
  );

  /** Decode a picked file into an image / video element, then add the sticker. */
  const onStickerFile = useCallback(
    (file: File, source: 'image' | 'video') => {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      const srcId = `stkmedia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      if (source === 'image') {
        const img = new Image();
        img.onload = () => {
          stickerMedia.current.set(srcId, img);
          addStickerLayer('image', srcId, img.naturalWidth, img.naturalHeight, 0);
        };
        img.onerror = () => setStatus('Could not load that image.');
        img.src = url;
      } else {
        const v = document.createElement('video');
        v.src = url;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.addEventListener('loadedmetadata', () => {
          stickerMedia.current.set(srcId, v);
          addStickerLayer('video', srcId, v.videoWidth, v.videoHeight, v.duration || 0);
        });
        v.addEventListener('error', () => setStatus('Could not load that video.'));
      }
    },
    [addStickerLayer],
  );

  const updateStickerEl = useCallback((id: string, patch: Partial<StickerElement>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'sticker' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  const updateCaptionEl = useCallback((layerId: string, patch: Partial<Caption> | Partial<TypewriterCaption>) => {
    setLayers((ls) =>
      ls.map((l) => (l.id === layerId && l.kind === 'caption' ? { ...l, el: { ...l.el, ...patch } as CaptionEl } : l)),
    );
  }, []);

  const updateBanner = useCallback((id: string, patch: Partial<BannerLayer>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'banner' ? { ...l, ...patch } : l)));
  }, []);

  const updateBannerStyle = useCallback((id: string, patch: Partial<BannerStyle>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'banner' ? { ...l, style: { ...l.style, ...patch } } : l)));
  }, []);

  const updateSketchEl = useCallback((id: string, patch: Partial<SketchElement>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'sketch' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  const commitSketchStroke = useCallback((id: string, stroke: SketchStroke) => {
    sealDiscrete(); // each committed stroke is its own undo step
    setLayers((ls) =>
      ls.map((l) => (l.id === id && l.kind === 'sketch' ? { ...l, el: { ...l.el, strokes: [...l.el.strokes, stroke] } } : l)),
    );
  }, [sealDiscrete]);

  const undoSketchStroke = useCallback((id: string) => {
    sealDiscrete();
    setLayers((ls) =>
      ls.map((l) => (l.id === id && l.kind === 'sketch' ? { ...l, el: { ...l.el, strokes: l.el.strokes.slice(0, -1) } } : l)),
    );
  }, [sealDiscrete]);

  const clearSketchStrokes = useCallback((id: string) => {
    sealDiscrete();
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'sketch' ? { ...l, el: { ...l.el, strokes: [] } } : l)));
  }, [sealDiscrete]);

  const updateHighlighterEl = useCallback((id: string, patch: Partial<Highlighter>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'highlighter' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  const updateDramaticEl = useCallback((id: string, patch: Partial<DramaticWord>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'dramatic' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  const removeLayer = useCallback(
    (id: string) => {
      sealDiscrete();
      setLayers((ls) => ls.filter((l) => l.id !== id));
      setSelectedLayerId((s) => (s === id ? null : s));
      setSelectedAttachmentId(null);
      setCroppingId((c) => (c === id ? null : c));
      clearZoomEdit();
    },
    [clearZoomEdit, sealDiscrete],
  );

  // Escape cancels / Enter confirms the delete dialog.
  useEffect(() => {
    if (!confirmDeleteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDeleteId(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        removeLayer(confirmDeleteId);
        setConfirmDeleteId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDeleteId, removeLayer]);

  const moveLayer = useCallback((id: string, dir: -1 | 1) => {
    sealDiscrete();
    setLayers((ls) => {
      const overlays = ls.filter((l) => l.kind !== 'zoom' && l.kind !== 'timemachine').sort((a, b) => a.z - b.z);
      const idx = overlays.findIndex((l) => l.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= overlays.length) return ls;
      const a = overlays[idx];
      const b = overlays[j];
      return ls.map((l) => (l.id === a.id ? { ...l, z: b.z } : l.id === b.id ? { ...l, z: a.z } : l));
    });
  }, [sealDiscrete]);

  // ---- attachments ----
  const attachMid = useCallback((el: CaptionEl, att: Attachment): number => {
    const sw = staticWindowOf(el);
    if (!sw) return midOfCaption(el);
    return Math.max(sw.start, Math.min(sw.end - 0.01, sw.start + att.startInStatic + att.duration / 2));
  }, [midOfCaption]);

  const addAttachment = useCallback(
    (layerId: string, type: AttachmentType) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'caption') return;
      const sw = staticWindowOf(layer.el);
      if (!sw) return;
      sealDiscrete();
      const dur = Math.max(0.2, Math.min(1.2, sw.end - sw.start));
      const att = createAttachment({ type, duration: dur, startInStatic: 0, wordStart: 0, wordEnd: 0 });
      updateCaptionEl(layerId, { attachments: [...layer.el.attachments, att] } as Partial<CaptionEl>);
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(att.id);
      seekTo(attachMid(layer.el, att));
    },
    [layers, updateCaptionEl, seekTo, attachMid, sealDiscrete],
  );

  const updateAttachment = useCallback(
    (layerId: string, attId: string, patch: Partial<Attachment>) => {
      setLayers((ls) =>
        ls.map((l) =>
          l.id === layerId && l.kind === 'caption'
            ? { ...l, el: { ...l.el, attachments: l.el.attachments.map((a) => (a.id === attId ? { ...a, ...patch } : a)) } as CaptionEl }
            : l,
        ),
      );
    },
    [],
  );

  const removeAttachment = useCallback((layerId: string, attId: string) => {
    sealDiscrete();
    setLayers((ls) =>
      ls.map((l) =>
        l.id === layerId && l.kind === 'caption'
          ? { ...l, el: { ...l.el, attachments: l.el.attachments.filter((a) => a.id !== attId) } as CaptionEl }
          : l,
      ),
    );
    setSelectedAttachmentId((s) => (s === attId ? null : s));
  }, [sealDiscrete]);

  const selectAttachment = useCallback(
    (layerId: string, attId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'caption') return;
      clearZoomEdit();
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(attId);
      const att = layer.el.attachments.find((a) => a.id === attId);
      if (att) seekTo(attachMid(layer.el, att));
    },
    [layers, clearZoomEdit, seekTo, attachMid],
  );

  // ---- zoom keyframes ----
  const landingOf = useCallback(
    (kf: ZoomKeyframe) => Math.min(kf.start + kf.duration, timelineDuration),
    [timelineDuration],
  );

  const selectZoomKf = useCallback(
    (layerId: string, kfId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'zoom') return;
      const kf = layer.keyframes.find((k) => k.id === kfId);
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(null);
      setSelectedZoomKfId(kfId);
      if (kf) {
        setEditingZoomBoth(true);
        compRef.current?.editZoomAt(landingOf(kf));
        setCurrentSec(landingOf(kf));
      }
    },
    [layers, landingOf],
  );

  const addZoomKeyframe = useCallback(
    (rect: ZoomRect) => {
      if (!zoom) return;
      sealDiscrete();
      const total = mediaKind === 'video' ? timelineDuration : Math.max(timelineDuration, 6);
      const isFirst = zoom.keyframes.length === 0;
      const prevEnd = zoom.keyframes.reduce((m, k) => Math.max(m, k.start + k.duration), 0);
      // First zoom (the classic "static zoom / Ken Burns" look): centre it so the
      // clip gets an equal hold → zoom → hold. Later zooms chain off the previous.
      const dur = isFirst ? Math.min(3, total * 0.5) : 1;
      const start = isFirst ? Math.max(0, (total - dur) / 2) : Math.min(prevEnd + 0.3, Math.max(0, total - 0.5));
      const kf = createZoom({ start, duration: dur, rect });
      setLayers((ls) => ls.map((l) => (l.id === zoom.id && l.kind === 'zoom' ? { ...l, keyframes: [...l.keyframes, kf] } : l)));
      setSelectedLayerId(zoom.id);
      setSelectedZoomKfId(kf.id);
      setEditingZoomBoth(true);
      const landing = Math.min(start + dur, total);
      compRef.current?.editZoomAt(landing);
      setCurrentSec(landing);
    },
    [zoom, mediaKind, timelineDuration, sealDiscrete],
  );

  const updateZoomKf = useCallback((layerId: string, kfId: string, patch: Partial<ZoomKeyframe>) => {
    setLayers((ls) =>
      ls.map((l) => (l.id === layerId && l.kind === 'zoom' ? { ...l, keyframes: l.keyframes.map((k) => (k.id === kfId ? { ...k, ...patch } : k)) } : l)),
    );
  }, []);

  const removeZoomKf = useCallback(
    (layerId: string, kfId: string) => {
      sealDiscrete();
      setLayers((ls) => ls.map((l) => (l.id === layerId && l.kind === 'zoom' ? { ...l, keyframes: l.keyframes.filter((k) => k.id !== kfId) } : l)));
      setSelectedZoomKfId((s) => (s === kfId ? null : s));
      setEditingZoomBoth(false);
      compRef.current?.exitEdit();
    },
    [sealDiscrete],
  );

  const onZoomRectChange = useCallback(
    (rect: ZoomRect) => {
      if (selectedLayerId && selectedZoomKfId) updateZoomKf(selectedLayerId, selectedZoomKfId, { rect });
    },
    [selectedLayerId, selectedZoomKfId, updateZoomKf],
  );

  // ---- time-machine (speed) keyframes ----
  const selectSpeedKf = useCallback(
    (layerId: string, kfId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'timemachine') return;
      const kf = layer.keyframes.find((k) => k.id === kfId);
      clearZoomEdit();
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(null);
      setSelectedSpeedKfId(kfId);
      if (kf) seekTo(Math.min(kf.start + kf.duration, timelineDuration));
    },
    [layers, clearZoomEdit, seekTo, timelineDuration],
  );

  /** Placement for a newly-added speed keyframe: at the playhead, after the last one. */
  const speedKfStart = useCallback((): number => {
    if (!timeMachine) return 0;
    const prevEnd = timeMachine.keyframes.reduce((m, k) => Math.max(m, k.start + k.duration), 0);
    return Math.min(Math.max(0, timelineDuration - 0.3), Math.max(currentSec, prevEnd));
  }, [timeMachine, timelineDuration, currentSec]);

  const addSpeedKeyframe = useCallback(
    (speed: number) => {
      if (!timeMachine) return;
      sealDiscrete();
      const start = speedKfStart();
      const kf = createSpeed({ start, duration: 0.6, speed });
      setLayers((ls) => ls.map((l) => (l.id === timeMachine.id && l.kind === 'timemachine' ? { ...l, keyframes: [...l.keyframes, kf] } : l)));
      setSelectedLayerId(timeMachine.id);
      setSelectedAttachmentId(null);
      setSelectedSpeedKfId(kf.id);
      seekTo(start + 0.6);
    },
    [timeMachine, speedKfStart, seekTo, sealDiscrete],
  );

  /** "+ Freeze": a snap to speed 0, then a resume to 1× a fixed hold later. */
  const addFreezeBlock = useCallback(() => {
    if (!timeMachine) return;
    sealDiscrete();
    const start = speedKfStart();
    const freeze = createSpeed({ start, duration: FREEZE_SNAP_RAMP, speed: 0 });
    const resume = createSpeed({ start: start + FREEZE_SNAP_RAMP + FREEZE_BLOCK_HOLD, duration: FREEZE_SNAP_RAMP, speed: 1 });
    setLayers((ls) =>
      ls.map((l) => (l.id === timeMachine.id && l.kind === 'timemachine' ? { ...l, keyframes: [...l.keyframes, freeze, resume] } : l)),
    );
    setSelectedLayerId(timeMachine.id);
    setSelectedAttachmentId(null);
    setSelectedSpeedKfId(freeze.id);
    seekTo(start + FREEZE_SNAP_RAMP + FREEZE_BLOCK_HOLD / 2);
  }, [timeMachine, speedKfStart, seekTo, sealDiscrete]);

  const updateSpeedKf = useCallback((layerId: string, kfId: string, patch: Partial<SpeedKeyframe>) => {
    setLayers((ls) =>
      ls.map((l) => (l.id === layerId && l.kind === 'timemachine' ? { ...l, keyframes: l.keyframes.map((k) => (k.id === kfId ? { ...k, ...patch } : k)) } : l)),
    );
  }, []);

  const removeSpeedKf = useCallback(
    (layerId: string, kfId: string) => {
      sealDiscrete();
      setLayers((ls) => ls.map((l) => (l.id === layerId && l.kind === 'timemachine' ? { ...l, keyframes: l.keyframes.filter((k) => k.id !== kfId) } : l)));
      setSelectedSpeedKfId((s) => (s === kfId ? null : s));
    },
    [sealDiscrete],
  );

  // ---- selecting a layer (list / timeline) ----
  const selectLayer = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      setSelectedLayerId(id);
      setSelectedAttachmentId(null);
      setCroppingId((c) => (c === id ? c : null)); // leave crop mode when switching layers
      if (layer.kind === 'zoom') {
        const first = layer.keyframes[0];
        if (first) selectZoomKf(id, first.id);
        else {
          clearZoomEdit();
        }
        return;
      }
      if (layer.kind === 'timemachine') {
        clearZoomEdit();
        const first = [...layer.keyframes].sort((a, b) => a.start - b.start)[0];
        setSelectedSpeedKfId(first?.id ?? null);
        if (first) seekTo(Math.min(first.start + first.duration, timelineDuration));
        return;
      }
      setSelectedSpeedKfId(null);
      clearZoomEdit();
      if (layer.kind === 'banner') seekTo(bannerPreviewTime(layer));
      else if (layer.kind === 'caption') seekTo(midOfCaption(layer.el));
      else if (layer.kind === 'sketch') seekTo(layer.el.start + layer.el.animationDur + Math.min(0.3, layer.el.freezeDur / 2));
      else if (layer.kind === 'highlighter') seekTo(layer.el.start + Math.min(0.5, layer.el.duration / 2));
      else if (layer.kind === 'dramatic') seekTo(layer.el.start + Math.min(0.5, layer.el.duration / 2));
      else if (layer.kind === 'sticker') seekTo(layer.el.start + Math.min(0.5, layer.el.hold / 2));
    },
    [layers, selectZoomKf, clearZoomEdit, seekTo, midOfCaption, bannerPreviewTime, timelineDuration],
  );

  // ---- playback ----
  const play = useCallback(() => {
    setSelectedLayerId(null);
    setSelectedAttachmentId(null);
    setSelectedZoomKfId(null);
    setSelectedSpeedKfId(null);
    setEditingZoomBoth(false);
    // Resume from the current playhead rather than restarting at 0.
    compRef.current?.playPreview(currentSec);
  }, [currentSec]);

  const onScrub = useCallback(
    (sec: number) => {
      setCurrentSec(sec);
      if (editingRef.current) compRef.current?.editZoomAt(sec);
      else compRef.current?.scrubTo(sec);
    },
    [],
  );

  // ---- canvas selection (single-layer transforms are owned by TransformBox) ----
  const normFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    return { nx: (clientX - rect.left) / rect.width, ny: (clientY - rect.top) / rect.height };
  }, []);

  // ---- transformable-layer plumbing ----
  const effectiveGuides = guidesOn ? guideSettings : GUIDES_OFF;

  /** Commit a TransformBox change back to the selected layer. */
  const onTransform = useCallback(
    (layer: PlaceableLayer, t: Transform) => {
      if (layer.kind === 'sketch') updateSketchEl(layer.id, { x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation });
      else if (layer.kind === 'highlighter') updateHighlighterEl(layer.id, { x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation });
      else if (layer.kind === 'sticker') updateStickerEl(layer.id, { x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation });
      else {
        // caption / dramatic: box centre → anchor; box width → uniform font scale.
        const g = textGrab.current;
        const ref = g && g.id === layer.id ? g : { sizeScale: layer.el.sizeScale, w: Math.max(1e-4, t.w) };
        const sizeScale = Math.max(0.08, ref.sizeScale * (t.w / Math.max(1e-4, ref.w)));
        const patch = { x: t.x + t.w / 2, y: t.y + t.h / 2, rotation: t.rotation, sizeScale };
        if (layer.kind === 'caption') updateCaptionEl(layer.id, patch);
        else updateDramaticEl(layer.id, patch);
      }
    },
    [updateSketchEl, updateHighlighterEl, updateStickerEl, updateCaptionEl, updateDramaticEl],
  );

  /** Double-click a sticker on the canvas to toggle crop mode for it. */
  const onCanvasDoubleClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (editingRef.current) return;
      const c = compRef.current;
      if (!c) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const hit = c.hitTestDraggable(nx, ny);
      const target = hit ?? (selectedLayer?.kind === 'sticker' ? selectedLayer.id : null);
      if (!target) return;
      const layer = layers.find((l) => l.id === target);
      if (!layer || layer.kind !== 'sticker') return;
      setSelectedLayerId(target);
      setSelectedAttachmentId(null);
      setCroppingId((cur) => (cur === target ? null : target));
    },
    [normFromPointer, layers, selectedLayer],
  );

  // ---- export ----
  const busy = stage === 'recording' || stage === 'preparing' || stage === 'encoding';

  const doExport = useCallback(async () => {
    const c = compRef.current;
    if (!c || !mediaKind) return;
    if (typeof MediaRecorder === 'undefined') {
      setStatus('Recording is not supported in this browser.');
      return;
    }
    setSelectedLayerId(null);
    setSelectedZoomKfId(null);
    setSelectedSpeedKfId(null);
    setEditingZoomBoth(false);
    setDownloadUrl(null);
    setStage('recording');
    setProgress(0);
    setStatus('Recording the composite in real time…');
    try {
      const total = c.totalSec();
      const webm = await c.record((sec) => setProgress(Math.min(0.99, sec / Math.max(0.1, total))));
      let outBlob: Blob = webm;
      let ext = 'webm';
      let type = 'video/webm';
      try {
        setStage('preparing');
        setStatus('Preparing the MP4 encoder (one-time download)…');
        await ensureFFmpeg();
        setStage('encoding');
        setStatus('Encoding MP4 (H.264)…');
        setProgress(0);
        outBlob = await transcodeToMp4(webm, (p) => setProgress(p));
        ext = 'mp4';
        type = 'video/mp4';
      } catch (err) {
        console.error('MP4 transcode failed, falling back to WebM', err);
        setStatus('MP4 encoding failed — providing the WebM instead.');
      }
      const blob = new Blob([outBlob], { type });
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      setDownloadUrl(url);
      setDownloadName(`camera.${ext}`);
      setStage('done');
      setProgress(1);
      if (ext === 'mp4') setStatus('Done — MP4 ready to download.');
    } catch (err) {
      console.error(err);
      setStage('error');
      setStatus('Export failed. See the console for details.');
    }
  }, [mediaKind]);

  const out = srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : { w: 1080, h: 1920 };
  const selectedZoomRect =
    editingZoom && selectedLayer?.kind === 'zoom' ? selectedLayer.keyframes.find((k) => k.id === selectedZoomKfId)?.rect ?? null : null;

  // Measured placement boxes for every placeable layer (pure — no compositor ref).
  const placeableBoxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const l of layers) {
      if (!isPlaceable(l)) continue;
      const b = measurePlaceableBox(l, project, out, currentSec);
      if (b) m[l.id] = b;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, project, out.w, out.h, currentSec]);
  const selBox = selectedLayer && isPlaceable(selectedLayer) ? placeableBoxes[selectedLayer.id] ?? null : null;
  const otherBoxes = useMemo(
    () => Object.entries(placeableBoxes).filter(([id]) => id !== selectedLayerId).map(([, b]) => b),
    [placeableBoxes, selectedLayerId],
  );

  // Effective group selection: the raw group only counts when it still holds the
  // primary and has >1 member; otherwise selection is just the primary layer.
  const groupSel = useMemo(() => {
    if (selectedLayerId && groupIds.length > 1 && groupIds.includes(selectedLayerId)) {
      return groupIds.filter((id) => placeableBoxes[id]);
    }
    return selectedLayerId ? [selectedLayerId] : [];
  }, [groupIds, selectedLayerId, placeableBoxes]);
  const isGroup = groupSel.length > 1;

  /** Union box of the group selection (output-normalised), for its outline. */
  const groupBox = useMemo(() => {
    if (!isGroup) return null;
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const id of groupSel) {
      const b = placeableBoxes[id];
      if (!b) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [isGroup, groupSel, placeableBoxes]);

  // ---- canvas pointer: select, shift-select, marquee, and group move ----
  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (editingRef.current) return; // zoom-rect editor owns the canvas
      const c = compRef.current;
      if (!c) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const hit = c.hitTestDraggable(nx, ny);
      const capture = () => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };

      if (e.shiftKey) {
        // Toggle a layer in/out of the group selection.
        if (!hit) return;
        setSelectedAttachmentId(null);
        setGroupIds((g) => {
          const base = selectedLayerId && g.includes(selectedLayerId) ? g : selectedLayerId ? [selectedLayerId] : [];
          const next = base.includes(hit) ? base.filter((id) => id !== hit) : [...base, hit];
          setSelectedLayerId(next[next.length - 1] ?? null);
          return next;
        });
        return;
      }

      if (!hit) {
        // Empty canvas: begin a marquee drag-select.
        setSelectedLayerId(null);
        setSelectedAttachmentId(null);
        setGroupIds([]);
        marqueeStart.current = { x: nx, y: ny };
        setMarquee({ x: nx, y: ny, w: 0, h: 0 });
        capture();
        return;
      }

      // Click on a member of the current group → start moving the whole group.
      if (isGroup && groupSel.includes(hit)) {
        const items = groupSel
          .map((id) => {
            const b = placeableBoxes[id];
            const layer = layers.find((l) => l.id === id);
            if (!b || !isPlaceable(layer)) return null;
            // Anchor each layer by its stored position (box top-left for boxes,
            // centre for text) so relative arrangement is preserved.
            return layer.kind === 'caption' || layer.kind === 'dramatic'
              ? { id, x: layer.el.x, y: layer.el.y }
              : { id, x: b.x, y: b.y };
          })
          .filter((v): v is { id: string; x: number; y: number } => !!v);
        groupDrag.current = { startN: { x: nx, y: ny }, items };
        capture();
        return;
      }

      // Plain single selection.
      setSelectedLayerId(hit);
      setSelectedAttachmentId(null);
      setGroupIds([hit]);
    },
    [normFromPointer, selectedLayerId, isGroup, groupSel, placeableBoxes, layers],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (e.buttons === 0) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);

      if (marqueeStart.current) {
        const s = marqueeStart.current;
        setMarquee({ x: Math.min(s.x, nx), y: Math.min(s.y, ny), w: Math.abs(nx - s.x), h: Math.abs(ny - s.y) });
        return;
      }

      const gd = groupDrag.current;
      if (gd) {
        let dx = nx - gd.startN.x;
        let dy = ny - gd.startN.y;
        if (groupBox && effectiveGuides) {
          const moved: Box = { x: groupBox.x + dx, y: groupBox.y + dy, w: groupBox.w, h: groupBox.h };
          const r = snapMove(moved, { settings: effectiveGuides, others: otherBoxes, cursor: { x: nx, y: ny } });
          dx = r.box.x - groupBox.x;
          dy = r.box.y - groupBox.y;
          setGuideLines(r.guides);
        }
        for (const it of gd.items) {
          const layer = layers.find((l) => l.id === it.id);
          if (!isPlaceable(layer)) continue;
          const pos = { x: it.x + dx, y: it.y + dy };
          if (layer.kind === 'sketch') updateSketchEl(it.id, pos);
          else if (layer.kind === 'highlighter') updateHighlighterEl(it.id, pos);
          else if (layer.kind === 'caption') updateCaptionEl(it.id, pos);
          else updateDramaticEl(it.id, pos);
        }
      }
    },
    [normFromPointer, groupBox, effectiveGuides, otherBoxes, layers, updateSketchEl, updateHighlighterEl, updateCaptionEl, updateDramaticEl],
  );

  const onCanvasPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (marqueeStart.current && marquee) {
        // Commit the marquee: select every placeable box it intersects.
        const m = marquee;
        const hit: string[] = [];
        for (const [id, b] of Object.entries(placeableBoxes)) {
          if (b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y) hit.push(id);
        }
        setGroupIds(hit);
        setSelectedLayerId(hit[hit.length - 1] ?? null);
      }
      marqueeStart.current = null;
      groupDrag.current = null;
      setMarquee(null);
      setGuideLines([]);
    },
    [marquee, placeableBoxes],
  );

  return (
    <IpadFrame orientation="landscape" ariaLabel="Camera">
      <div className="ios-editor text-[var(--color-text-primary)]">
        {/* Top bar */}
        <header className="sticky top-0 z-40 px-5 pt-3">
          <div className="ios-glass max-w-7xl mx-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 rounded-[20px]">
            <a href="/" className="justify-self-start inline-flex items-center gap-1 text-[15px] font-medium text-[var(--color-accent)] px-2.5 py-1.5 rounded-xl hover:bg-[rgba(0,122,255,0.08)] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Home</span>
            </a>
            <div className="inline-flex items-center gap-2 text-[17px] font-semibold">
              <span aria-hidden>🎥</span>
              <span>Camera</span>
            </div>
            <a href="/video-classic/" className="justify-self-end text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] font-mono hidden sm:block">
              classic ↗
            </a>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-5 pt-6 pb-28">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-3 mb-1">
            <span aria-hidden>🎬</span>
            <span className="gradient-text">Layer editor</span>
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-1 mb-6 max-w-2xl text-[15px] leading-relaxed">
            One clip, one timeline. Add a banner, captions, and a zoom as layers, arrange them, and export a single MP4 — all in your browser.
          </p>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
            {/* ---- Preview + timeline ---- */}
            <section>
              <label className="block glass-card p-4 mb-4 cursor-pointer hover:bg-[var(--color-glass-hover)] transition-colors">
                <span className="text-sm font-medium">Photo or video</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="block mt-2 text-sm text-[var(--color-text-secondary)] file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-primary)]"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
              </label>

              {/* Hidden pickers for sticker media (triggered from the + menu). */}
              <input
                ref={stickerImageInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onStickerFile(f, 'image');
                  e.target.value = '';
                }}
              />
              <input
                ref={stickerVideoInput}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onStickerFile(f, 'video');
                  e.target.value = '';
                }}
              />

              <div className="glass-card p-3">
                <div ref={wrapRef} className="relative mx-auto max-w-[420px]">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={onCanvasPointerDown}
                    onPointerMove={onCanvasPointerMove}
                    onPointerUp={onCanvasPointerUp}
                    onDoubleClick={onCanvasDoubleClick}
                    className="w-full h-auto rounded-lg bg-black block touch-none"
                    width={1080}
                    height={1920}
                  />

                  {/* zoom-rect editor overlay */}
                  {selectedZoomRect && mediaKind && srcDims.w > 0 && (
                    <ZoomRectEditor rect={selectedZoomRect} srcW={srcDims.w} srcH={srcDims.h} out={out} settings={effectiveGuides} onChange={onZoomRectChange} />
                  )}

                  {/* group-move selection: union outline (single-layer widget hidden) */}
                  {isGroup && groupBox && mediaKind && (
                    <div
                      className="pointer-events-none absolute z-10 border-2 border-dashed border-[var(--color-primary-green)]"
                      style={{ left: `${groupBox.x * 100}%`, top: `${groupBox.y * 100}%`, width: `${groupBox.w * 100}%`, height: `${groupBox.h * 100}%` }}
                    />
                  )}

                  {/* marquee drag-select rectangle */}
                  {marquee && (
                    <div
                      className="pointer-events-none absolute z-10 border border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.12)]"
                      style={{ left: `${marquee.x * 100}%`, top: `${marquee.y * 100}%`, width: `${marquee.w * 100}%`, height: `${marquee.h * 100}%` }}
                    />
                  )}

                  {/* sticker crop editor (double-click) — replaces the transform widget */}
                  {croppingId &&
                    mediaKind &&
                    srcDims.w > 0 &&
                    selectedLayer?.kind === 'sticker' &&
                    selectedLayer.id === croppingId && (
                      <StickerCropEditor
                        el={selectedLayer.el}
                        media={stickerMedia.current.get(selectedLayer.el.srcId)}
                        onChange={(patch) => updateStickerEl(selectedLayer.id, patch)}
                      />
                    )}

                  {/* unified transform widget for the single selected placeable layer */}
                  {!editingZoom &&
                    !isGroup &&
                    mediaKind &&
                    srcDims.w > 0 &&
                    isPlaceable(selectedLayer) &&
                    selBox &&
                    !(selectedLayer.kind === 'sticker' && selectedLayer.id === croppingId) &&
                    !(selectedLayer.kind === 'sketch' && selectedLayer.el.strokes.length === 0) &&
                    (() => {
                      const sel: PlaceableLayer = selectedLayer;
                      const box = selBox;
                      const t: Transform = { ...box, rotation: rotationOf(sel) };
                      const locked = sel.kind !== 'highlighter';
                      let lockedAspectPx: number | undefined;
                      if (sel.kind === 'sketch') lockedAspectPx = sel.el.padAspect;
                      else if (locked) lockedAspectPx = (box.w * out.w) / Math.max(1e-4, box.h * out.h);
                      return (
                        <TransformBox
                          transform={t}
                          resize={locked ? 'locked' : 'free'}
                          lockedAspectPx={lockedAspectPx}
                          out={out}
                          settings={effectiveGuides}
                          others={otherBoxes}
                          onGrab={() => {
                            if (sel.kind === 'caption' || sel.kind === 'dramatic') {
                              textGrab.current = { id: sel.id, sizeScale: sel.el.sizeScale, w: box.w };
                            }
                          }}
                          onChange={(nt) => onTransform(sel, nt)}
                          onGuides={setGuideLines}
                        />
                      );
                    })()}

                  {/* safe zones */}
                  {showSafeZones && ratio === '9:16' && !editingZoom && (
                    <div className="pointer-events-none absolute inset-0 rounded-lg overflow-hidden">
                      <div className="absolute inset-x-0 top-0 h-[12%] bg-[rgba(255,0,80,0.1)] border-b border-[rgba(255,0,80,0.3)]" />
                      <div className="absolute inset-x-0 bottom-0 h-[20%] bg-[rgba(255,0,80,0.1)] border-t border-[rgba(255,0,80,0.3)]" />
                      <div className="absolute top-[12%] bottom-[20%] right-0 w-[7%] bg-[rgba(255,0,80,0.08)] border-l border-[rgba(255,0,80,0.25)]" />
                    </div>
                  )}
                  {/* alignment guides (from the shared snap engine) */}
                  {guideLines.map((g, i) =>
                    g.axis === 'x' ? (
                      <div key={i} className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]" style={{ left: `${g.at * 100}%` }} />
                    ) : (
                      <div key={i} className="pointer-events-none absolute left-0 right-0 h-px bg-[#b57cff] shadow-[0_0_6px_#b57cff]" style={{ top: `${g.at * 100}%` }} />
                    ),
                  )}

                  {/* corner "+" add-layer button */}
                  {mediaKind && (
                    <div className="absolute top-2 right-2">
                      <button
                        onClick={() => setAddOpen((v) => !v)}
                        disabled={busy}
                        className="w-9 h-9 rounded-full bg-[var(--color-primary-green)] text-black text-xl font-bold shadow-md flex items-center justify-center disabled:opacity-40"
                        title="Add a layer"
                        aria-label="Add a layer"
                      >
                        +
                      </button>
                      {addOpen && (
                        <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-glass-border)] overflow-hidden z-20">
                          {ADD_ITEMS.map((it) => {
                            const tmUnavailable = it.kind === 'timemachine' && mediaKind !== 'video';
                            const disabled =
                              (it.kind === 'banner' && !!banner) ||
                              (it.kind === 'zoom' && !!zoom) ||
                              (it.kind === 'timemachine' && !!timeMachine) ||
                              tmUnavailable;
                            return (
                              <button
                                key={it.kind}
                                onClick={() => addLayer(it.kind)}
                                disabled={disabled}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-[var(--color-glass-hover)] disabled:opacity-35 disabled:cursor-not-allowed"
                              >
                                <span aria-hidden>{it.icon}</span>
                                <span>{it.label}</span>
                                {disabled && (
                                  <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{tmUnavailable ? 'video only' : 'added'}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* corner guide-lock (gear) affordance */}
                  {mediaKind && (
                    <div
                      className="absolute top-2 left-2"
                      onMouseEnter={() => setGearOpen(true)}
                      onMouseLeave={() => setGearOpen(false)}
                    >
                      <button
                        onClick={() => setGearOpen((v) => !v)}
                        className={`w-9 h-9 rounded-full shadow-md flex items-center justify-center text-lg transition-colors ${
                          guidesOn ? 'bg-[var(--color-bg-surface)] text-[var(--color-primary-green)]' : 'bg-[var(--color-bg-surface)] text-[var(--color-text-muted)]'
                        }`}
                        title="Guide locks"
                        aria-label="Guide locks"
                      >
                        ⚙
                      </button>
                      {gearOpen && (
                        <div className="absolute left-0 mt-1.5 w-52 rounded-xl bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-glass-border)] overflow-hidden z-20 p-2 text-sm">
                          <label className="flex items-center gap-2 px-2 py-1.5 font-medium">
                            <input type="checkbox" checked={guidesOn} onChange={(e) => setGuidesOn(e.target.checked)} />
                            <span>Guides &amp; snapping</span>
                          </label>
                          <div className={`mt-1 border-t border-[var(--color-glass-border)] pt-1 ${guidesOn ? '' : 'opacity-40 pointer-events-none'}`}>
                            {GUIDE_TOGGLES.map((g) => (
                              <label key={g.key} className="flex items-center gap-2 px-2 py-1 hover:bg-[var(--color-glass-hover)] rounded-md cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={guideSettings[g.key]}
                                  onChange={(e) => setGuideSettings((s) => ({ ...s, [g.key]: e.target.checked }))}
                                />
                                <span>{g.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!mediaKind && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">Upload to preview</div>}
                </div>

                {editingZoom && (
                  <p className="text-[11px] text-[var(--color-primary-green)] mt-2 text-center">
                    Editing zoom rectangle — showing the full original frame. Drag the box; it snaps to centre / output ratio.
                  </p>
                )}

                {mediaKind && (
                  <ProjectTimeline
                    duration={timelineDuration}
                    layers={displayLayers}
                    currentSec={currentSec}
                    selectedLayerId={selectedLayerId}
                    selectedAttachmentId={selectedAttachmentId}
                    selectedZoomKfId={selectedZoomKfId}
                    selectedSpeedKfId={selectedSpeedKfId}
                    onScrub={onScrub}
                    onSelectLayer={selectLayer}
                    onEditCaption={updateCaptionEl}
                    onSelectAttachment={selectAttachment}
                    onEditAttachment={updateAttachment}
                    onEditBanner={updateBanner}
                    onSelectZoomKf={selectZoomKf}
                    onEditZoomKf={updateZoomKf}
                    onSelectSpeedKf={selectSpeedKf}
                    onEditSpeedKf={updateSpeedKf}
                    onEditSketch={updateSketchEl}
                    onEditHighlighter={updateHighlighterEl}
                    onEditDramatic={updateDramaticEl}
                    onEditSticker={updateStickerEl}
                  />
                )}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button onClick={play} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                    ▶ Play preview
                  </button>
                  <button onClick={undo} disabled={!history.canUndo || busy} title="Undo (⌘Z / Ctrl+Z)" className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                    ↶ Undo
                  </button>
                  <button onClick={redo} disabled={!history.canRedo || busy} title="Redo (⇧⌘Z / Ctrl+Y)" className="px-3 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                    ↷ Redo
                  </button>
                  <button onClick={() => setAddOpen((v) => !v)} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] disabled:opacity-40 text-sm font-medium">
                    + Add layer
                  </button>
                  <button onClick={doExport} disabled={!mediaKind || busy} className="px-4 py-2 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm">
                    {busy ? 'Working…' : 'Export MP4'}
                  </button>
                  {downloadUrl && (
                    <a href={downloadUrl} download={downloadName} className="px-4 py-2 rounded-md border border-[var(--color-primary-green)] text-[var(--color-primary-green)] text-sm font-medium">
                      ↓ Save {downloadName.endsWith('.mp4') ? 'MP4' : 'WebM'}
                    </a>
                  )}
                </div>

                {busy && (
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-secondary)] mt-2 font-mono">{status}</p>
              </div>
            </section>

            {/* ---- Controls ---- */}
            <aside className="space-y-6">
              {/* Layers list */}
              <Panel title="Layers">
                {layers.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-secondary)]">{mediaKind ? 'Add a banner, caption, or zoom with the “+” button.' : 'Upload a photo or video to begin.'}</p>
                ) : (
                  <div className="space-y-1">
                    {displayLayers.map((l) => {
                      const isSel = l.id === selectedLayerId;
                      const icon =
                        l.kind === 'banner'
                          ? '⚔️'
                          : l.kind === 'zoom'
                            ? '🔍'
                            : l.kind === 'timemachine'
                              ? '⏱️'
                              : l.kind === 'sketch'
                                ? '✏️'
                                : l.kind === 'sticker'
                                  ? l.el.source === 'video'
                                    ? '🎬'
                                    : '🖼️'
                                : l.kind === 'highlighter'
                                  ? '🖍️'
                                  : l.kind === 'dramatic'
                                    ? l.el.mode === 'inverse'
                                      ? '◱'
                                      : l.el.mode === 'reflection'
                                        ? '🔃'
                                        : '🔠'
                                    : l.el.kind === 'typewriter'
                                      ? '⌨️'
                                      : '💬';
                      const label =
                        l.kind === 'caption'
                          ? l.el.text.split('\n')[0] || l.name
                          : l.kind === 'dramatic'
                            ? (l.el.text || l.name).toUpperCase()
                            : l.name;
                      const canMove = l.kind !== 'zoom' && l.kind !== 'timemachine';
                      return (
                        <div key={l.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border ${isSel ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'}`}>
                          <button onClick={() => selectLayer(l.id)} className="flex items-center gap-2 text-left text-[13px] min-w-0 flex-1">
                            <span aria-hidden>{icon}</span>
                            <span className="truncate">{label}</span>
                            {(l.kind === 'zoom' || l.kind === 'timemachine') && <span className="text-[10px] text-[var(--color-text-muted)]">base</span>}
                          </button>
                          {canMove && (
                            <>
                              <button onClick={() => moveLayer(l.id, 1)} title="Bring forward" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1">↑</button>
                              <button onClick={() => moveLayer(l.id, -1)} title="Send backward" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1">↓</button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* Selected-layer property panel */}
              {selectedLayer && (
                <Panel
                  title={
                    selectedLayer.kind === 'banner'
                      ? 'Entrance Banner'
                      : selectedLayer.kind === 'zoom'
                        ? 'Zoom'
                        : selectedLayer.kind === 'timemachine'
                          ? 'Time Machine'
                        : selectedLayer.kind === 'sketch'
                          ? 'Sketch'
                          : selectedLayer.kind === 'sticker'
                            ? selectedLayer.el.source === 'video'
                              ? 'Video sticker'
                              : 'Image sticker'
                          : selectedLayer.kind === 'highlighter'
                            ? 'Highlighter'
                            : selectedLayer.kind === 'dramatic'
                              ? selectedLayer.el.mode === 'inverse'
                                ? 'Inverse word'
                                : selectedLayer.el.mode === 'reflection'
                                  ? 'Reflection word'
                                  : 'Dramatic word'
                              : selectedLayer.el.kind === 'typewriter'
                                ? 'Typewriter'
                                : 'Caption'
                  }
                >
                  {selectedLayer.kind === 'caption' && (
                    <CaptionPanel
                      layer={selectedLayer as CaptionLayer}
                      duration={timelineDuration}
                      boilPool={boilPool}
                      selectedAttachmentId={selectedAttachmentId}
                      onEdit={(patch) => updateCaptionEl(selectedLayer.id, patch)}
                      onAddAttachment={(type) => addAttachment(selectedLayer.id, type)}
                      onSelectAttachment={(attId) => selectAttachment(selectedLayer.id, attId)}
                      onEditAttachment={(attId, patch) => updateAttachment(selectedLayer.id, attId, patch)}
                      onRemoveAttachment={(attId) => removeAttachment(selectedLayer.id, attId)}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'banner' && (
                    <BannerPanel
                      layer={selectedLayer as BannerLayer}
                      duration={timelineDuration}
                      onEdit={(patch) => updateBanner(selectedLayer.id, patch)}
                      onEditStyle={(patch) => updateBannerStyle(selectedLayer.id, patch)}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'zoom' && (
                    <ZoomPanel
                      layer={selectedLayer as ZoomLayer}
                      duration={timelineDuration}
                      ratio={ratio}
                      srcDims={srcDims}
                      selectedKfId={selectedZoomKfId}
                      onAddKeyframe={addZoomKeyframe}
                      onSelectKf={(kfId) => selectZoomKf(selectedLayer.id, kfId)}
                      onEditKf={(kfId, patch) => updateZoomKf(selectedLayer.id, kfId, patch)}
                      onRemoveKf={(kfId) => removeZoomKf(selectedLayer.id, kfId)}
                      onRemoveLayer={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'timemachine' && (
                    <TimeMachinePanel
                      layer={selectedLayer as TimeMachineLayer}
                      duration={timelineDuration}
                      selectedKfId={selectedSpeedKfId}
                      onAddKeyframe={addSpeedKeyframe}
                      onAddFreeze={addFreezeBlock}
                      onSelectKf={(kfId) => selectSpeedKf(selectedLayer.id, kfId)}
                      onEditKf={(kfId, patch) => updateSpeedKf(selectedLayer.id, kfId, patch)}
                      onRemoveKf={(kfId) => removeSpeedKf(selectedLayer.id, kfId)}
                      onRemoveLayer={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'sketch' && (
                    <SketchPanel
                      layer={selectedLayer as SketchLayer}
                      pen={pen}
                      onPen={(patch) => setPen((p) => ({ ...p, ...patch }))}
                      onCommitStroke={(s) => commitSketchStroke(selectedLayer.id, s)}
                      onUndoStroke={() => undoSketchStroke(selectedLayer.id)}
                      onClearStrokes={() => clearSketchStrokes(selectedLayer.id)}
                      onEdit={(patch) => updateSketchEl(selectedLayer.id, patch)}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'highlighter' && (
                    <HighlighterPanel
                      layer={selectedLayer as HighlighterLayer}
                      duration={timelineDuration}
                      onEdit={(patch) => updateHighlighterEl(selectedLayer.id, patch)}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'dramatic' && (
                    <DramaticPanel
                      layer={selectedLayer as DramaticLayer}
                      duration={timelineDuration}
                      onEdit={(patch) => updateDramaticEl(selectedLayer.id, patch)}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'sticker' && (
                    <StickerPanel
                      layer={selectedLayer as StickerLayer}
                      duration={timelineDuration}
                      cropping={croppingId === selectedLayer.id}
                      onEdit={(patch) => updateStickerEl(selectedLayer.id, patch)}
                      onToggleCrop={() => setCroppingId((c) => (c === selectedLayer.id ? null : selectedLayer.id))}
                      onRemove={() => setConfirmDeleteId(selectedLayer.id)}
                    />
                  )}
                </Panel>
              )}

              {/* Project output settings */}
              <Panel title="Output">
                <Field label="Aspect ratio">
                  <ChoiceGrid cols={2} value={ratio} options={RATIO_LABELS} onChange={(v) => { sealDiscrete(); setRatio(v); }} />
                </Field>
                <Field label="Fill mode (when input ratio ≠ output)">
                  <ChoiceGrid cols={3} value={fillMode} options={FILL_MODES.map((m) => ({ key: m, label: m === 'crop' ? 'Crop' : m === 'fit' ? 'Fit' : 'Blur' }))} onChange={(v) => { sealDiscrete(); setFillMode(v); }} />
                </Field>
                {mediaKind === 'image' && (
                  <Field label={`Clip length — ${imageDuration.toFixed(1)}s`}>
                    <input type="range" min={2} max={20} step={0.5} value={imageDuration} onChange={(e) => setImageDuration(Number(e.target.value))} className="w-full accent-[var(--color-primary-green)]" />
                  </Field>
                )}
                <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={guidesOn} onChange={(e) => setGuidesOn(e.target.checked)} />
                    Guides
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} />
                    Safe zones
                  </label>
                </div>
              </Panel>

              <Panel title="Font boil">
                <Field label="Font pool (applies to all captions)">
                  <div className="grid grid-cols-3 gap-1.5">
                    {FONT_POOLS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          sealDiscrete();
                          setBoilPool(p.id);
                          setLayers((ls) =>
                            ls.map((l) =>
                              l.kind === 'caption' && l.el.kind === 'boil' && l.el.settleFontIndex >= p.fonts.length
                                ? { ...l, el: { ...l.el, settleFontIndex: p.fonts.length - 1 } }
                                : l,
                            ),
                          );
                        }}
                        className={`px-1 py-2 rounded-md text-[11px] border ${boilPool === p.id ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={normalize} onChange={(e) => { sealDiscrete(); setNormalize(e.target.checked); }} />
                  Even sizing (normalize each font to a consistent height)
                </label>
              </Panel>

              <Panel title="Sound effects">
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={sfxEnabled} onChange={(e) => { sealDiscrete(); setSfxEnabled(e.target.checked); }} />
                  Enable (banner slash, caption riffle/keys, zoom whoosh, sketch pencil)
                </label>
                {sfxEnabled && (
                  <Field label={`SFX volume — ${Math.round(sfxVolume * 100)}%`}>
                    <input type="range" min={0} max={1} step={0.05} value={sfxVolume} onChange={(e) => setSfxVolume(Number(e.target.value))} className="w-full accent-[var(--color-primary-green)]" />
                  </Field>
                )}
              </Panel>
            </aside>
          </div>
        </div>

        {/* delete-layer confirmation dialog */}
        {confirmDeleteId &&
          (() => {
            const target = layers.find((l) => l.id === confirmDeleteId);
            if (!target) return null;
            const label =
              target.kind === 'caption'
                ? target.el.text.split('\n')[0] || target.name
                : target.kind === 'dramatic'
                  ? (target.el.text || target.name).toUpperCase()
                  : target.name;
            return (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="dialog" aria-modal="true">
                <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDeleteId(null)} />
                <div className="relative glass-card p-5 max-w-xs w-full text-center">
                  <h2 className="text-base font-semibold mb-1">Delete layer?</h2>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                    “{label}” will be removed. You can undo this with ⌘Z.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-4 py-2 rounded-md bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-surface)] text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      autoFocus
                      onClick={() => {
                        removeLayer(confirmDeleteId);
                        setConfirmDeleteId(null);
                      }}
                      className="px-4 py-2 rounded-md bg-[rgba(255,80,80,0.92)] text-white text-sm font-semibold hover:bg-[rgba(255,80,80,1)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </IpadFrame>
  );
}
