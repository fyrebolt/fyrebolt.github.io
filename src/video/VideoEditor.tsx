import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import IpadFrame from '../ios/IpadFrame';
import { Compositor } from './project/Compositor';
import type { ClipEl } from './project/Compositor';
import ProjectTimeline from './project/ProjectTimeline';
import type { ClipExtent } from './project/ClipLane';
import ClipStrip from './project/ClipStrip';
import { forgetWaveform } from './project/waveform';
import ZoomRectEditor from './zoom/ZoomRectEditor';
import TransformBox from './transform/TransformBox';
import type { Transform } from './transform/TransformBox';
import type { Box, GuideSettings, Guide } from './transform/snapEngine';
import { DEFAULT_GUIDES, snapMove } from './transform/snapEngine';
import { measurePlaceableBox } from './transform/measure';
import { fillPlacement, outputSizeFor } from './render';
import { transcodeToMp4, ensureFFmpeg } from './ffmpeg';
import { preloadAllFontPools, FONT_POOLS } from './captions/fonts';
import type { BoilPoolId } from './captions/fonts';
import { createAttachment, staticWindowOf } from './captions/types';
import type { Attachment, AttachmentType, Caption, CaptionEl, TypewriterCaption } from './captions/types';
import FindReplace from './captions/FindReplace';
import { replaceAllInText, replaceOneAt } from './captions/search';
import type { CaptionText } from './captions/search';
import { createZoom } from './zoom/types';
import type { ZoomKeyframe, ZoomRect } from './zoom/types';
import { applySpeedRegion, clampSpeed, speedAt, REGION_RAMP, REGION_HOLD, FREEZE_RAMP } from './timemachine/types';
import type { SpeedPoint } from './timemachine/types';
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
  activeProject,
  bannerLayers,
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
  createMusicLayer,
} from './project/types';
import type { CropRect, StickerElement } from './sticker/types';
import type { VideoClip } from './project/clips';
import {
  createBlankClip,
  createClip,
  clipLen,
  clipZ,
  baseDuration,
  isBlank,
  isFullCrop,
  isStill,
  layoutClips,
  sizingClip,
  splitClip,
  BLANK_CLIP_LEN,
  FULL_CLIP_CROP,
  MIN_CLIP_LEN,
  IMAGE_CLIP_MAX,
} from './project/clips';
import type { Transition } from './project/transitions';
import {
  clampDuration as clampTransitionDur,
  randomizeAll as randomizeAllTransitions,
  transitionAt,
} from './project/transitions';
import type { ColorGrade } from './project/grade';
import { NEUTRAL_GRADE } from './project/grade';
import type { Marker } from './project/markers';
import { createMarker, markerAt, stepMarker } from './project/markers';
import MarkerPanel from './project/panels/MarkerPanel';
import { compileWarp, bannerBlockedSpans, fitBannerFreeze, fitBannerHold } from './project/timeMap';
import { Panel, Section, Field, ChoiceGrid, Slider, NumberInput } from './project/ui';
import { RATIO_LABELS, FILL_MODES, FRAME_SEC } from './project/constants';
import CaptionPanel from './project/panels/CaptionPanel';
import BannerPanel from './project/panels/BannerPanel';
import ZoomPanel from './project/panels/ZoomPanel';
import TimeMachinePanel from './project/panels/TimeMachinePanel';
import SketchPanel from './project/panels/SketchPanel';
import type { Pen } from './project/panels/SketchPanel';
import HighlighterPanel from './project/panels/HighlighterPanel';
import DramaticPanel from './project/panels/DramaticPanel';
import StickerPanel from './project/panels/StickerPanel';
import ClipPanel from './project/panels/ClipPanel';
import ClipPlacementPanel from './project/panels/ClipPlacementPanel';
import TransitionPanel from './project/panels/TransitionPanel';
import GradePanel from './project/panels/GradePanel';
import MusicPanel from './project/panels/MusicPanel';
import type { MusicElement } from './music/types';
import CropEditor from './transform/CropEditor';
import { useHistory } from './project/useHistory';
import type { HistoryApi } from './project/useHistory';
import type { PersistSnapshot, MediaEntry, LoadedProject, LibraryEntry, LibraryMedia } from './project/persist';
import {
  saveSnapshot,
  saveMedia,
  pruneMedia,
  loadProject,
  clearProject,
  referencedSrcIds,
  exportProjectJSON,
  importProjectJSON,
  listLibrary,
  addToLibrary,
  libraryEntryByHash,
  renameLibraryEntry,
  deleteLibraryEntry,
} from './project/persist';
import { hashBlob, makeThumb } from './project/thumbnail';
import LibraryBrowser from './project/LibraryBrowser';

/** A fresh `prefix-…` id. One generator for every id minted in the editor
 *  (clips, clip sources, sticker/music media, layer + element clones). */
function freshId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Icon-only button in the transport bar. Labelled via title + aria-label. */
const TOOL_BTN = 'tool-btn px-2.5 py-1.5 rounded-md text-sm min-w-[34px]';

/** One row in a toolbar dropdown (project menu, add-layer menu). */
function MenuItem({
  onClick,
  disabled,
  icon,
  label,
  hint,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: string;
  label: string;
  /** Trailing note — why a row is unavailable, or what it will actually do. */
  hint?: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-[var(--color-glass-hover)] disabled:opacity-35 disabled:cursor-not-allowed ${
        danger ? 'text-[rgba(255,120,120,0.95)]' : ''
      }`}
    >
      <span className="w-4 text-center" aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
      {hint && <span className="ml-auto pl-2 shrink-0 text-[10px] text-[var(--color-text-muted)]">{hint}</span>}
    </button>
  );
}

/** True when the key event is aimed at a text field, so editor shortcuts must
 *  stand down and let the browser's native text handling win. */
function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Cmd (macOS) or Ctrl (elsewhere) — the editor treats them interchangeably. */
const hasMod = (e: KeyboardEvent): boolean => e.metaKey || e.ctrlKey;

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
  clips: VideoClip[];
  layers: Layer[];
  ratio: RatioKey;
  fillMode: FillMode;
  boilPool: BoilPoolId;
  normalize: boolean;
  sfxEnabled: boolean;
  sfxVolume: number;
  imageDuration: number;
  globalGrade: ColorGrade;
  markers: Marker[];
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
  snapClips: false,
  snapElements: false,
  snapPlayhead: false,
  snapMarkers: false,
};

const TIME_GUIDE_TOGGLES: { key: keyof GuideSettings; label: string }[] = [
  { key: 'snapClips', label: 'Snap to clip edges' },
  { key: 'snapElements', label: 'Snap to other elements' },
  { key: 'snapPlayhead', label: 'Snap to playhead' },
  { key: 'snapMarkers', label: 'Snap to markers' },
];

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
  | 'sticker-video'
  | 'music';

/** The add menu, grouped — thirteen flat rows of emoji were unscannable. */
const ADD_GROUPS: { group: string; items: { kind: AddKind; label: string; icon: string }[] }[] = [
  {
    group: 'Text',
    items: [
      { kind: 'boil', label: 'Caption', icon: '💬' },
      { kind: 'typewriter', label: 'Typewriter', icon: '⌨️' },
      { kind: 'dramatic-normal', label: 'Dramatic word', icon: '🔠' },
      { kind: 'dramatic-inverse', label: 'Inverse word', icon: '◱' },
      { kind: 'dramatic-reflection', label: 'Reflection word', icon: '🔃' },
      { kind: 'banner', label: 'Entrance banner', icon: '⚔️' },
    ],
  },
  {
    group: 'Media',
    items: [
      { kind: 'sticker-image', label: 'Image sticker', icon: '🖼️' },
      { kind: 'sticker-video', label: 'Video sticker', icon: '🎬' },
      { kind: 'music', label: 'Music track', icon: '🎵' },
    ],
  },
  {
    group: 'Motion',
    items: [
      { kind: 'zoom', label: 'Zoom', icon: '🔍' },
      { kind: 'timemachine', label: 'Time Machine', icon: '⏱️' },
    ],
  },
  {
    group: 'Drawing',
    items: [
      { kind: 'sketch', label: 'Sketch', icon: '✏️' },
      { kind: 'highlighter', label: 'Highlighter', icon: '🖍️' },
    ],
  },
];

/** Where an asset from the library is being inserted (decides filter + decode). */
type LibraryIntent = 'clip' | 'sticker-image' | 'sticker-video' | 'music';
/** Which library media kinds are valid to reuse for each intent. */
const LIBRARY_INTENT_MEDIA: Record<LibraryIntent, LibraryMedia[]> = {
  clip: ['video', 'image'],
  'sticker-image': ['image'],
  'sticker-video': ['video'],
  music: ['audio'],
};
const LIBRARY_INTENT_TITLE: Record<LibraryIntent, string> = {
  clip: 'Add a clip',
  'sticker-image': 'Add an image sticker',
  'sticker-video': 'Add a video sticker',
  music: 'Add a music track',
};
const LIBRARY_INTENT_EMPTY: Record<LibraryIntent, string> = {
  clip: 'No saved clips yet. Upload one and it’ll appear here for reuse in any project.',
  'sticker-image': 'No saved image stickers yet. Upload one and it’ll appear here for reuse.',
  'sticker-video': 'No saved video stickers yet. Upload one and it’ll appear here for reuse.',
  music: 'No saved music yet. Upload a track and it’ll appear here for reuse in any project.',
};

export default function VideoEditor() {
  // ---- media ----
  const [currentSec, setCurrentSec] = useState(0); // OUTPUT seconds

  // ---- project ----
  // The base timeline: an ordered list of stitched clips. mediaKind / duration /
  // srcDims below are DERIVED from it, so a one-clip project == the old single source.
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [ratio, setRatio] = useState<RatioKey>('9:16');
  const [fillMode, setFillMode] = useState<FillMode>('crop');
  const [boilPool, setBoilPool] = useState<BoilPoolId>('default');
  const [normalize, setNormalize] = useState(true);
  const [sfxEnabled, setSfxEnabled] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.5);
  const [imageDuration, setImageDuration] = useState(6);
  /** Global colour grade over the whole composited output (per-clip grades live on each clip). */
  const [globalGrade, setGlobalGrade] = useState<ColorGrade>(NEUTRAL_GRADE);
  /** Timeline markers — labelled instants on the output clock (editing aid only). */
  const [markers, setMarkers] = useState<Marker[]>([]);

  // Drawing-pad pen (shared tool state for sketch layers).
  const [pen, setPen] = useState<Pen>({ color: '#ff4d4d', width: 0.02, smoothness: 0.8 });

  // ---- selection / editing ----
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  /** Extra placeable ids co-selected for group move (raw; includes the primary). */
  const [groupIds, setGroupIds] = useState<string[]>([]);
  /** Marquee rect (output-normalised) while drag-selecting, else null. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedZoomKfId, setSelectedZoomKfId] = useState<string | null>(null);
  const [selectedSpeedIdx, setSelectedSpeedIdx] = useState<number | null>(null);
  const [editingZoom, setEditingZoom] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** Live preview play/pause state (reflects the compositor's actual playback). */
  const [isPlaying, setIsPlaying] = useState(false);
  /** In-app full-screen (breaks out of the iPad frame + dock). Transient view state. */
  const [fullscreen, setFullscreen] = useState(false);
  /** Find & Replace panel (Cmd/Ctrl+F) open state. */
  const [findOpen, setFindOpen] = useState(false);

  // ---- ui ----
  const [showSafeZones, setShowSafeZones] = useState(true);
  /** True while a file is being dragged over the upload / preview drop zone. */
  const [dragOver, setDragOver] = useState(false);
  const [guidesOn, setGuidesOn] = useState(true);
  const [guideSettings, setGuideSettings] = useState<GuideSettings>(DEFAULT_GUIDES);
  const [gearOpen, setGearOpen] = useState(false);
  const [guideLines, setGuideLines] = useState<Guide[]>([]);
  /** Header "Project" menu (save / load / clear the autosave). */
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  /** True while any toolbar dropdown is open. A ref because the other keyboard
   *  handlers must see the CURRENT value: this effect's Escape runs first and
   *  clears the state, and a stale closure would let Escape both close the menu
   *  and (say) drop out of full screen in one press. */
  const menuOpenRef = useRef(false);
  menuOpenRef.current = addOpen || gearOpen || projectMenuOpen;

  // One outside-click rule for every toolbar dropdown: a pointerdown that lands
  // outside any [data-menu] wrapper closes them all. Escape does the same.
  useEffect(() => {
    const closeAll = () => {
      setAddOpen(false);
      setGearOpen(false);
      setProjectMenuOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-menu]')) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // ---- undo / redo history (stable wrappers; the engine is created below) ----
  const historyRef = useRef<HistoryApi | null>(null);
  const sealDiscrete = useCallback(() => historyRef.current?.sealDiscrete(), []);
  const undo = useCallback(() => historyRef.current?.undo(), []);
  const redo = useCallback(() => historyRef.current?.redo(), []);
  /** Layer id pending a delete confirmation, else null. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /** Autosave indicator: 'idle' (nothing pending), 'saving' (write in flight), 'saved'. */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ---- export ----
  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Upload a photo or video, then add layers with “+ Add”.');
  // Transient note when a banner edit was clamped to avoid a freeze/warp overlap.
  const [bannerConflict, setBannerConflict] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('camera.mp4');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const projectRef = useRef<Project>({ clips: [], layers: [], ratio, fillMode, defaultBoilPool: boilPool, defaultNormalize: normalize, sfxEnabled, sfxVolume, imageDuration, grade: NEUTRAL_GRADE });
  /** The project MINUS hidden layers — what the compositor draws, sounds, and warps.
   *  Kept apart from `projectRef` (the full project) because editor-side reads must
   *  still see hidden layers: `setLayers(projectRef.current.layers)` call sites would
   *  otherwise delete them. See activeProject() in project/types.ts. */
  const renderRef = useRef<Project>(projectRef.current);
  const objectUrls = useRef<string[]>([]);
  /** Decoded clip media (video / image), keyed by clip srcId, kept out of the project. */
  const clipMedia = useRef<Map<string, ClipEl>>(new Map());
  /** Original source blob per clip srcId (lossless — for waveform + JSON/autosave). */
  const clipBlobs = useRef<Map<string, Blob>>(new Map());
  /** Hidden file input used to add another clip to the sequence. */
  const clipInput = useRef<HTMLInputElement>(null);
  /** Decoded sticker media (image / video), kept out of the project so layers stay plain data. */
  const stickerMedia = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map());
  /** Original sticker source blobs per srcId (lossless — for JSON/autosave). */
  const stickerBlobs = useRef<Map<string, Blob>>(new Map());
  /** Decoded music tracks (HTMLAudioElement), kept out of the project. */
  const musicMedia = useRef<Map<string, HTMLAudioElement>>(new Map());
  /** Original music source blobs per srcId (lossless — for JSON/autosave). */
  const musicBlobs = useRef<Map<string, Blob>>(new Map());
  /** Hidden file input for adding a background-music track. */
  const musicInput = useRef<HTMLInputElement>(null);
  /** Hidden file input for loading a project JSON. */
  const projectInput = useRef<HTMLInputElement>(null);
  /** Hidden file inputs used to pick sticker media on demand. */
  const stickerImageInput = useRef<HTMLInputElement>(null);
  const stickerVideoInput = useRef<HTMLInputElement>(null);
  /** Sticker layer currently in crop mode (double-clicked), else null. */
  const [croppingId, setCroppingId] = useState<string | null>(null);
  /** Selected base clip (its transform widget + placement / audio / colour panels). */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  /** Base clip currently in crop mode (double-clicked), else null. */
  const [cropClipId, setCropClipId] = useState<string | null>(null);
  /** Size/rotation reference captured when a text-layer transform grab starts. */
  const textGrab = useRef<{ id: string; sizeScale: number; w: number } | null>(null);
  /** Group-move gesture: ids + each layer's origin (x,y) captured at grab. */
  const groupDrag = useRef<{ startN: { x: number; y: number }; items: { id: string; x: number; y: number }[] } | null>(null);
  /** Marquee gesture origin (normalised), else null. */
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const editingRef = useRef(false);

  const project: Project = useMemo(
    () => ({ clips, layers, ratio, fillMode, defaultBoilPool: boilPool, defaultNormalize: normalize, sfxEnabled, sfxVolume, imageDuration, grade: globalGrade, markers }),
    [clips, layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, globalGrade, markers],
  );
  /** Memoised so its identity is stable per edit — the compositor caches its
   *  compiled warp against it. */
  const renderProject = useMemo(() => activeProject(project), [project]);

  // ---- media facts DERIVED from the clip sequence ----
  // 'video' if any clip is video, else 'image', else null (nothing loaded).
  const mediaKind: MediaKind = useMemo(
    () => (clips.length === 0 ? null : clips.some((c) => c.kind === 'video') ? 'video' : 'image'),
    [clips],
  );
  // Base-sequence duration (sum of trimmed clip lengths) — the old single "clip seconds".
  const duration = useMemo(() => baseDuration(clips), [clips]);
  // Output sizing reference = the first clip that HAS native dimensions, so a
  // project opening on a blank clip still sizes off its real footage.
  const srcDims = useMemo(() => {
    const c = sizingClip(clips);
    return c ? { w: c.w, h: c.h } : { w: 0, h: 0 };
  }, [clips]);

  // The output frame size, derived once. Memoised because it feeds the placeable-box
  // measurement below, which re-measures every text layer against an offscreen
  // canvas — a fresh object each render would redo that work on every keystroke.
  // With no clip loaded we still size a nominal 1080×1920 source through the ratio.
  const out = useMemo(
    () => (srcDims.w > 0 ? outputSizeFor(ratio, srcDims.w, srcDims.h) : outputSizeFor(ratio, 1080, 1920)),
    [ratio, srcDims.w, srcDims.h],
  );

  const zoom = zoomLayer(project);
  const timeMachine = timeMachineLayer(project);
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null;

  // Output (paint bottom→top) + a display order for the list/timeline (front first).
  // Zoom + Time Machine are base tracks — they sit at the bottom of the stack.
  const displayLayers = useMemo(() => {
    const overlays = overlayLayers(project).slice().reverse(); // front first
    const music = project.layers.filter((l) => l.kind === 'music'); // audio-only rows
    const bases = project.layers.filter((l) => l.kind === 'zoom' || l.kind === 'timemachine');
    return [...overlays, ...music, ...bases];
  }, [project]);

  // Output→source time-warp (video only). Drives the timeline length AND where
  // each clip boundary lands on the OUTPUT axis (for the clip lane + snapping).
  // Compiled from the RENDER project so hiding a banner or the Time Machine drops
  // its distortion from the timeline exactly as it drops from the output.
  const warp = useMemo(
    () => (mediaKind === 'video' ? compileWarp(renderProject, duration, true) : null),
    [renderProject, mediaKind, duration],
  );

  // Timeline / output duration (seconds). For video this is the warped output
  // length (speed track + banner freeze can stretch or shrink it).
  const timelineDuration = useMemo(() => {
    if (mediaKind === 'video' && warp) return Math.max(0.1, warp.totalOutput);
    // Stills: measured over ALL layers, hidden included, so a hidden layer's row
    // stays on-screen and reachable for editing / un-hiding.
    const ends = layers.map((l) => layerSpan(l).end);
    return Math.max(3, duration, ...ends);
  }, [warp, mediaKind, duration, layers]);

  // Base clips as OUTPUT-time extents (warped) for the timeline clip lane. Clips
  // may overlap, so these come from the shared layout rather than a running sum.
  const clipExtents = useMemo<ClipExtent[]>(
    () =>
      layoutClips(clips).map((p) => ({
        id: p.clip.id,
        srcId: p.clip.srcId,
        name: p.clip.name,
        kind: p.clip.kind,
        inSec: p.clip.in,
        outSec: p.clip.out,
        start: warp ? warp.outputAt(p.start) : p.start,
        end: warp ? warp.outputAt(p.end) : p.end,
        z: clipZ(p.clip, p.index),
      })),
    [clips, warp],
  );

  // Unique clip-boundary times (OUTPUT seconds) for temporal snapping.
  const clipEdges = useMemo(() => {
    const set = new Set<number>();
    for (const e of clipExtents) {
      set.add(+e.start.toFixed(4));
      set.add(+e.end.toFixed(4));
    }
    return [...set].sort((a, b) => a - b);
  }, [clipExtents]);

  const getClipBlob = useCallback((srcId: string) => clipBlobs.current.get(srcId), []);

  // Preload fonts up front so switching pools / drawing never falls back.
  useEffect(() => {
    preloadAllFontPools().then(() => compRef.current?.renderStatic());
  }, []);

  // Keep the compositor's project source current + redraw on edits.
  useEffect(() => {
    projectRef.current = project;
    renderRef.current = renderProject;
    const c = compRef.current;
    if (!c) return;
    if (editingRef.current) c.redrawEditZoom();
    else c.renderStatic();
  }, [project, renderProject]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const c = new Compositor(
      canvasRef.current,
      () => renderRef.current,
      (srcId) => clipMedia.current.get(srcId),
      (sec) => setCurrentSec(sec),
      (srcId) => stickerMedia.current.get(srcId),
      (srcId) => musicMedia.current.get(srcId),
    );
    compRef.current = c;
    return () => {
      c.destroy();
      compRef.current = null;
    };
  }, []);

  // Callback ref for the preview canvas. Toggling full screen swaps the wrapper
  // (IpadFrame ↔ full-screen div), which remounts the <canvas> to a new DOM node;
  // re-point the (long-lived) compositor at it so it keeps drawing to what's shown.
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (node) compRef.current?.setCanvas(node);
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /** Ask to delete a layer. Locked layers refuse — deletion is the one destructive
   *  edit a lock must stop, so it is checked before the dialog even opens. */
  const requestDelete = useCallback((id: string) => {
    if (projectRef.current.layers.find((l) => l.id === id)?.locked) {
      setStatus('That layer is locked — unlock it in Layers (🔒) to delete it.');
      return;
    }
    setConfirmDeleteId(id);
  }, []);

  // ---- keyboard: undo / redo + delete the selected layer ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmDeleteId) return; // the delete-confirm dialog owns the keyboard
      const editable = isEditableTarget(e);
      const mod = hasMod(e);

      // An open toolbar menu owns the first Escape; crop mode gets the next one.
      if (e.key === 'Escape' && (croppingId || cropClipId) && !menuOpenRef.current) {
        e.preventDefault();
        setCroppingId(null);
        setCropClipId(null);
        return;
      }

      // Cmd/Ctrl+F opens Find & Replace (caption text). Suppressed inside text
      // fields so the browser's native in-field find is left untouched.
      if (mod && (e.key === 'f' || e.key === 'F')) {
        if (editable) return;
        e.preventDefault();
        setFindOpen(true);
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
        requestDelete(selectedLayerId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedLayerId, confirmDeleteId, croppingId, cropClipId, requestDelete]);

  const setEditingZoomBoth = (v: boolean) => {
    editingRef.current = v;
    setEditingZoom(v);
  };

  // ---- undo / redo engine (whole-project snapshots) ----
  const snapshot: EditorSnapshot = useMemo(
    () => ({ clips, layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, globalGrade, markers, pen }),
    [clips, layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, globalGrade, markers, pen],
  );
  const restoreSnapshot = useCallback((s: EditorSnapshot) => {
    setClips(s.clips);
    setLayers(s.layers);
    setRatio(s.ratio);
    setFillMode(s.fillMode);
    setBoilPool(s.boilPool);
    setNormalize(s.normalize);
    setSfxEnabled(s.sfxEnabled);
    setSfxVolume(s.sfxVolume);
    setImageDuration(s.imageDuration);
    setGlobalGrade(s.globalGrade);
    setMarkers(s.markers);
    setPen(s.pen);
    // Reset transient editing state and clamp selection to layers that survive.
    editingRef.current = false;
    setEditingZoom(false);
    setSelectedZoomKfId(null);
    setSelectedSpeedIdx(null);
    compRef.current?.exitEdit();
    setSelectedAttachmentId(null);
    setGroupIds((g) => g.filter((id) => s.layers.some((l) => l.id === id)));
    setSelectedMarkerId((cur) => (cur && s.markers.some((m) => m.id === cur) ? cur : null));
    setSelectedLayerId((cur) => (cur && s.layers.some((l) => l.id === cur) ? cur : null));
    setCroppingId((cur) => (cur && s.layers.some((l) => l.id === cur) ? cur : null));
    setSelectedClipId((cur) => (cur && s.clips.some((c) => c.id === cur) ? cur : null));
    setCropClipId((cur) => (cur && s.clips.some((c) => c.id === cur) ? cur : null));
  }, []);
  const snapshotEqual = useCallback(
    (a: EditorSnapshot, b: EditorSnapshot) =>
      a.clips === b.clips &&
      a.layers === b.layers &&
      a.ratio === b.ratio &&
      a.fillMode === b.fillMode &&
      a.boilPool === b.boilPool &&
      a.normalize === b.normalize &&
      a.sfxEnabled === b.sfxEnabled &&
      a.sfxVolume === b.sfxVolume &&
      a.imageDuration === b.imageDuration &&
      a.globalGrade === b.globalGrade &&
      a.markers === b.markers &&
      a.pen === b.pen,
    [],
  );
  const history = useHistory<EditorSnapshot>({ live: snapshot, restore: restoreSnapshot, equal: snapshotEqual });
  // Published after commit rather than during render: the stable undo/redo/seal
  // wrappers above read this ref, and every caller is an event handler or effect,
  // which always runs after the effect below has published the current engine.
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // ---- cross-project asset library ----
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  /** Which insertion intent the library browser is open for, or null when closed. */
  const [libraryOpen, setLibraryOpen] = useState<LibraryIntent | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await listLibrary());
    } catch {
      /* IndexedDB unavailable — the library is simply empty this session. */
    }
  }, []);

  // Load the saved library once on mount (survives project switches + Clear).
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  /** Auto-save a NEW upload to the library (deduped by content hash). Never runs
   *  for a library INSERT — those already exist in the library. */
  const saveUploadToLibrary = useCallback(
    async (blob: Blob, name: string, media: LibraryMedia) => {
      try {
        const hash = await hashBlob(blob);
        if (await libraryEntryByHash(hash)) return; // same file already saved — reuse it
        const thumb = await makeThumb(media, blob);
        await addToLibrary({
          id: freshId('lib'),
          name: name || 'Asset',
          media,
          type: blob.type || 'application/octet-stream',
          blob,
          thumb,
          hash,
          addedAt: Date.now(),
        });
        await refreshLibrary();
      } catch {
        /* storage full / unavailable — non-fatal; the upload itself still works. */
      }
    },
    [refreshLibrary],
  );

  // ---- media load (append a clip to the base sequence) ----
  // Decode a clip source (video / image) from a blob and append it to the base
  // sequence, under a FRESH srcId. No library side effects — reused both by a new
  // upload (onFile) and by inserting a copy from the asset library.
  const ingestClipBlob = useCallback(
    (blob: Blob, name: string) => {
      const c = compRef.current;
      if (!c) return;
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      setDownloadUrl(null);
      setStage('idle');
      setProgress(0);

      const append = (clip: VideoClip) => {
        sealDiscrete();
        setClips((cs) => [...cs, clip]);
        setStatus(
          clip.kind === 'video'
            ? 'Clip added. Add more clips, add layers with “+”, then Export.'
            : 'Photo added. Add more clips or add layers with “+”.',
        );
      };

      if (blob.type.startsWith('video')) {
        const video = document.createElement('video');
        video.src = url;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';
        // Paint the opening frame as soon as it decodes (metadata alone isn't enough).
        video.addEventListener('loadeddata', () => compRef.current?.renderStatic(), { once: true });
        video.addEventListener('loadedmetadata', () => {
          const srcId = freshId('clipsrc');
          clipMedia.current.set(srcId, video);
          clipBlobs.current.set(srcId, blob);
          append(
            createClip({
              srcId,
              kind: 'video',
              name,
              srcDuration: video.duration,
              w: video.videoWidth,
              h: video.videoHeight,
            }),
          );
        });
      } else if (blob.type.startsWith('image')) {
        const image = new Image();
        image.onload = () => {
          const srcId = freshId('clipsrc');
          clipMedia.current.set(srcId, image);
          clipBlobs.current.set(srcId, blob);
          append(
            createClip(
              { srcId, kind: 'image', name, srcDuration: 0, w: image.naturalWidth, h: image.naturalHeight },
              { out: imageDuration },
            ),
          );
        };
        image.src = url;
      }
    },
    [imageDuration, sealDiscrete],
  );

  const onFile = useCallback(
    (file: File) => {
      const name = file.name.replace(/\.[^./\\]+$/, '') || 'Clip';
      ingestClipBlob(file, name);
      if (file.type.startsWith('video')) void saveUploadToLibrary(file, name, 'video');
      else if (file.type.startsWith('image')) void saveUploadToLibrary(file, name, 'image');
    },
    [ingestClipBlob, saveUploadToLibrary],
  );

  /** Accept any image/video files dropped onto the upload or preview zone. */
  const onDropFiles = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith('image') || f.type.startsWith('video'),
      );
      for (const f of files) onFile(f);
    },
    [onFile],
  );

  const onDragOverFiles = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);

  // ---- J/K/L shuttle transport state (declared early so play/pause/seek can
  //      halt it; the transport logic itself lives after the playback block) ----
  const shuttleRAF = useRef<number | null>(null);
  const transportRate = useRef(0); // 0 paused; >0 fwd; <0 back; |rate| = speed
  const stopShuttleLoop = useCallback(() => {
    if (shuttleRAF.current !== null) {
      cancelAnimationFrame(shuttleRAF.current);
      shuttleRAF.current = null;
    }
    transportRate.current = 0;
  }, []);

  // ---- seeking ----
  const seekTo = useCallback((sec: number) => {
    stopShuttleLoop();
    compRef.current?.scrubTo(sec); // scrubbing stops the preview loop
    setCurrentSec(sec);
    setIsPlaying(false);
  }, [stopShuttleLoop]);

  // Re-sync the compositor whenever a clip is added/removed: resize the canvas to
  // the first clip + paint. On the very first clip, land on the opening frame.
  const clipCountRef = useRef(0);
  useEffect(() => {
    const c = compRef.current;
    if (!c) return;
    if (clips.length !== clipCountRef.current) {
      const wasEmpty = clipCountRef.current === 0;
      clipCountRef.current = clips.length;
      c.attach();
      if (wasEmpty && clips.length > 0) seekTo(0);
    }
  }, [clips, seekTo]);

  // ---- clip sequence management ----
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  /** Selected clip BOUNDARY (index of the incoming clip) whose transition is being edited. */
  const [selectedBoundary, setSelectedBoundary] = useState<number | null>(null);

  /** Base-sequence start time of each clip (for scrubbing to a clip's head). */
  const clipStarts = useMemo(() => layoutClips(clips).map((p) => p.start), [clips]);

  /** Clip ids in paint order, bottom-first — the stacking order the panel edits. */
  const clipZOrder = useMemo(
    () =>
      clips
        .map((c, i) => ({ id: c.id, i, z: clipZ(c, i) }))
        .sort((a, b) => a.z - b.z || a.i - b.i)
        .map((o) => o.id),
    [clips],
  );

  const selectClip = useCallback(
    (id: string) => {
      setSelectedClipId((cur) => {
        if (cur !== id) setCropClipId(null); // leave crop mode when switching clips
        return id;
      });
      // A clip and a layer both own a transform widget, so selection is exclusive.
      setSelectedLayerId(null);
      setSelectedAttachmentId(null);
      const i = clips.findIndex((c) => c.id === id);
      if (i >= 0) seekTo(Math.min(clipStarts[i] + 0.001, timelineDuration));
    },
    [clips, clipStarts, seekTo, timelineDuration],
  );

  const reorderClip = useCallback(
    (from: number, to: number) => {
      setClips((cs) => {
        if (from < 0 || from >= cs.length || to < 0 || to >= cs.length || from === to) return cs;
        sealDiscrete();
        const next = cs.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [sealDiscrete],
  );

  const removeClip = useCallback(
    (id: string) => {
      sealDiscrete();
      setClips((cs) => {
        const gone = cs.find((c) => c.id === id);
        if (gone) forgetWaveform(gone.srcId);
        return cs.filter((c) => c.id !== id);
      });
      setSelectedClipId((cur) => (cur === id ? null : cur));
    },
    [sealDiscrete],
  );

  /** Trim a clip's in/out (SOURCE seconds), clamped to the media + min length. */
  const trimClip = useCallback((id: string, patch: { in?: number; out?: number }) => {
    setClips((cs) =>
      cs.map((c) => {
        if (c.id !== id) return c;
        const still = isStill(c);
        const max = still ? IMAGE_CLIP_MAX : c.srcDuration;
        let inP = still ? 0 : patch.in ?? c.in; // a still has no in-point
        let outP = patch.out ?? c.out;
        inP = Math.max(0, Math.min(inP, max - MIN_CLIP_LEN));
        outP = Math.max(inP + MIN_CLIP_LEN, Math.min(outP, max));
        return { ...c, in: inP, out: outP };
      }),
    );
  }, []);

  /** Patch a clip (volume curve / mute / placement). `discrete` seals its own undo entry. */
  const editClip = useCallback(
    (id: string, patch: Partial<VideoClip>, discrete = false) => {
      if (discrete) sealDiscrete();
      setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [sealDiscrete],
  );

  // ---- clip placement (transform + crop) ----
  //
  // A clip stores no transform/crop until it is actually placed, which is what
  // keeps existing projects untouched. The first placing edit therefore SEEDS both
  // from the clip's current on-screen appearance (fillPlacement), so grabbing the
  // widget never makes the picture jump: crop-to-fill hands over its cover crop,
  // fit / blur hand over their letterboxed box. Every edit flows through editClip,
  // so the shared snapshot history covers it like any other clip property.

  /** The clip's placement as it renders right now — its transform box + crop. */
  const placementOf = useCallback(
    (clip: VideoClip): { transform: Transform; crop: CropRect } => {
      const seed = fillPlacement(out, clip.w, clip.h, fillMode);
      return {
        transform: clip.transform ?? { ...seed.box, rotation: 0 },
        crop: clip.crop ?? seed.crop,
      };
    },
    [out, fillMode],
  );

  /**
   * Whether the USER has cropped this clip — as opposed to merely carrying the
   * crop that was seeded from the fill mode when it was first placed. Only a real
   * crop arms the double-click un-crop shortcut, otherwise simply moving a
   * crop-to-fill clip would make the next double-click un-crop instead of crop.
   */
  const hasUserCrop = useCallback(
    (clip: VideoClip): boolean => {
      if (!clip.crop || isFullCrop(clip)) return false;
      const seed = fillPlacement(out, clip.w, clip.h, fillMode).crop;
      const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
      return !(
        same(clip.crop.x, seed.x) &&
        same(clip.crop.y, seed.y) &&
        same(clip.crop.w, seed.w) &&
        same(clip.crop.h, seed.h)
      );
    },
    [out, fillMode],
  );

  /** Commit a TransformBox change to a clip, seeding its crop on the first edit. */
  const onClipTransform = useCallback(
    (clip: VideoClip, t: Transform) => {
      editClip(clip.id, { transform: t, crop: placementOf(clip).crop });
    },
    [editClip, placementOf],
  );

  /** Commit a crop-editor change: the new crop plus the box it implies. */
  const onClipCrop = useCallback(
    (clip: VideoClip, patch: { crop: CropRect; x: number; y: number; w: number; h: number }) => {
      const cur = placementOf(clip).transform;
      editClip(clip.id, {
        crop: patch.crop,
        transform: { x: patch.x, y: patch.y, w: patch.w, h: patch.h, rotation: cur.rotation },
      });
    },
    [editClip, placementOf],
  );

  /**
   * Reset a clip's crop to its full, uncropped source — the one-click "undo the
   * crop" a second double-click performs. The box grows back to where the whole
   * source sits at the crop's current scale (the inverse of the crop editor's own
   * maths), so the visible part of the picture doesn't move.
   */
  const uncropClip = useCallback(
    (clip: VideoClip) => {
      const { transform: t, crop } = placementOf(clip);
      const fullW = t.w / Math.max(1e-4, crop.w);
      const fullH = t.h / Math.max(1e-4, crop.h);
      editClip(
        clip.id,
        {
          crop: { ...FULL_CLIP_CROP },
          transform: { x: t.x - crop.x * fullW, y: t.y - crop.y * fullH, w: fullW, h: fullH, rotation: t.rotation },
        },
        true,
      );
    },
    [editClip, placementOf],
  );

  /** Restore a clip to the untouched full-frame default (no transform, no crop). */
  const resetClipPlacement = useCallback(
    (id: string) => {
      setCropClipId((c) => (c === id ? null : c));
      editClip(id, { transform: undefined, crop: undefined }, true);
    },
    [editClip],
  );

  /**
   * Move a clip along the base clock, pinning it with an explicit `baseStart`.
   * Once ANY clip is pinned the whole sequence is pinned, so the clips that used
   * to follow implicitly don't slide out from under the one being dragged.
   */
  const moveClipTo = useCallback((id: string, baseStart: number) => {
    setClips((cs) => {
      const lay = layoutClips(cs);
      return cs.map((c, i) => ({ ...c, baseStart: c.id === id ? Math.max(0, baseStart) : lay[i].start }));
    });
  }, []);

  /**
   * Drop every pin, restoring the strict back-to-back sequence. Pinned clips keep
   * their own times through a reorder (that is the point of pinning them), so this
   * is the way back to a plain sequential layout — and the way to make the clip
   * strip's reorder move clips in time again.
   */
  const reflowClips = useCallback(() => {
    sealDiscrete();
    setClips((cs) => cs.map((c) => ({ ...c, baseStart: undefined })));
  }, [sealDiscrete]);

  /** Timeline drag: the lane works in OUTPUT seconds, the pin lives in BASE time. */
  const moveClipToOutput = useCallback(
    (id: string, outputStart: number) => {
      moveClipTo(id, warp ? warp.sourceAt(outputStart) : outputStart);
    },
    [moveClipTo, warp],
  );

  /** Swap a clip's z with its neighbour in paint order (the layer list's pattern). */
  const moveClipZ = useCallback(
    (id: string, dir: -1 | 1) => {
      sealDiscrete();
      setClips((cs) => {
        const order = cs
          .map((c, i) => ({ id: c.id, i, z: clipZ(c, i) }))
          .sort((a, b) => a.z - b.z || a.i - b.i);
        const at = order.findIndex((o) => o.id === id);
        const to = at + dir;
        if (at < 0 || to < 0 || to >= order.length) return cs;
        const a = order[at];
        const b = order[to];
        return cs.map((c, i) => (c.id === a.id ? { ...c, z: b.z } : c.id === b.id ? { ...c, z: a.z } : { ...c, z: clipZ(c, i) }));
      });
    },
    [sealDiscrete],
  );

  // ---- clip-boundary transitions ----
  //
  // A transition lives on the INCOMING clip (`transitionIn`), so boundary index
  // i means "the boundary entering clip i". Editing one is an ordinary clip
  // patch, which puts it under the same snapshot history as every other edit.

  /** Set the whole transition at a boundary. `discrete` seals its own undo entry. */
  const setTransition = useCallback(
    (index: number, tr: Transition, discrete = false) => {
      if (discrete) sealDiscrete();
      setClips((cs) => {
        if (index <= 0 || index >= cs.length) return cs;
        const next = { ...tr, duration: clampTransitionDur(cs, index, tr.duration) };
        return cs.map((c, i) => (i === index ? { ...c, transitionIn: next.kind === 'cut' ? undefined : next } : c));
      });
    },
    [sealDiscrete],
  );

  /** Duration-only edit (the chip drag) — streamed, so the history coalesces it. */
  const setTransitionDur = useCallback(
    (index: number, dur: number) => {
      setClips((cs) => {
        if (index <= 0 || index >= cs.length) return cs;
        const cur = transitionAt(cs, index);
        // Dragging a boundary that is still a plain Cut turns it into the default
        // crossfade — the quickest way to get a transition onto a boundary.
        const kind = cur.kind === 'cut' ? 'crossfade' : cur.kind;
        const tr: Transition = { ...cur, kind, duration: clampTransitionDur(cs, index, dur) };
        return cs.map((c, i) => (i === index ? { ...c, transitionIn: tr } : c));
      });
    },
    [],
  );

  const randomizeTransitions = useCallback(() => {
    sealDiscrete();
    setClips((cs) => (cs.length > 1 ? randomizeAllTransitions(cs) : cs));
  }, [sealDiscrete]);

  /**
   * Append a BLANK clip — a stretch of blank screen with no media at all. It is
   * the timeline's gap / hold primitive: pad the end, hold on black between two
   * shots, or (because it takes part in boundary transitions like any other plain
   * clip) fade to black by putting a crossfade on its edge.
   */
  const addBlankClip = useCallback(() => {
    sealDiscrete();
    const clip = createBlankClip(BLANK_CLIP_LEN);
    setClips((cs) => [...cs, clip]);
    setSelectedClipId(clip.id);
    setStatus('Blank clip added — set its length on the strip, or crossfade into it to fade to black.');
  }, [sealDiscrete]);

  // ---- clip duplicate / copy / paste ----
  //
  // A clip resolves its decoded media by srcId (clipMedia). Two clips must NOT
  // share a srcId: the compositor steers/pre-rolls each clip's <video> element by
  // srcId, so a shared element would fight itself when the copy sits next to the
  // original. So a copy gets its OWN fresh element (same blob, new srcId) and a
  // deep-cloned settings object (grade/volume independent of the source).
  const clipClipboard = useRef<VideoClip | null>(null);

  const cloneClipWithMedia = useCallback(
    (src: VideoClip): VideoClip | null => {
      // A blank clip has no media to clone — it copies as plain data.
      if (isBlank(src)) return { ...structuredClone(src), id: freshId('clip') };
      const blob = clipBlobs.current.get(src.srcId);
      if (!blob) return null;
      const newSrcId = freshId('clipsrc');
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      if (src.kind === 'video') {
        const v = document.createElement('video');
        v.src = url;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.addEventListener('loadeddata', () => compRef.current?.renderStatic(), { once: true });
        clipMedia.current.set(newSrcId, v);
      } else {
        const img = new Image();
        img.onload = () => compRef.current?.renderStatic();
        img.src = url;
        clipMedia.current.set(newSrcId, img);
      }
      clipBlobs.current.set(newSrcId, blob);
      return { ...structuredClone(src), id: freshId('clip'), srcId: newSrcId };
    },
    [],
  );

  /** Insert a copy of `src` right after `afterId` (or at the end), and select it. */
  const insertClipCopy = useCallback(
    (src: VideoClip, afterId: string | null, failMsg: string) => {
      const clone = cloneClipWithMedia(src);
      if (!clone) {
        setStatus(failMsg);
        return;
      }
      sealDiscrete();
      setClips((cs) => {
        const j = afterId ? cs.findIndex((c) => c.id === afterId) : -1;
        const next = cs.slice();
        next.splice(j < 0 ? cs.length : j + 1, 0, clone);
        return next;
      });
      setSelectedClipId(clone.id);
    },
    [cloneClipWithMedia, sealDiscrete],
  );

  const duplicateClip = useCallback(
    (id: string) => {
      const src = clips.find((c) => c.id === id);
      if (!src) return;
      insertClipCopy(src, id, 'Cannot duplicate: source media unavailable.');
      setStatus('Clip duplicated.');
    },
    [clips, insertClipCopy],
  );

  const copyClip = useCallback(
    (id: string) => {
      const c = clips.find((x) => x.id === id);
      if (!c) return;
      clipClipboard.current = c;
      setStatus('Clip copied — paste with ⌘/Ctrl+V.');
    },
    [clips],
  );

  const pasteClip = useCallback(() => {
    const src = clipClipboard.current;
    if (!src) return;
    insertClipCopy(src, selectedClipId, 'Cannot paste: the copied clip’s media is no longer available.');
    setStatus('Clip pasted.');
  }, [insertClipCopy, selectedClipId]);

  /**
   * Razor: split the clip under the playhead into two independent clips at the
   * cursor. The clip-local cut offset comes from the compositor's warp so it
   * lands on the visible frame; the volume curve is redistributed by splitClip
   * (before → clip 1, after → clip 2 rebased). One undo entry via sealDiscrete.
   */
  const splitAtPlayhead = useCallback(() => {
    const comp = compRef.current;
    if (!comp) return;
    const info = comp.splitHitAt(comp.currentTimeSec());
    if (!info) return;
    const idx = clips.findIndex((c) => c.id === info.clipId);
    if (idx < 0) return;
    const parts = splitClip(clips[idx], info.local);
    if (!parts) {
      setStatus('Move the playhead further into the clip to split it (needs room on both sides).');
      return;
    }
    sealDiscrete();
    setClips((cs) => {
      const j = cs.findIndex((c) => c.id === info.clipId);
      if (j < 0) return cs;
      const next = cs.slice();
      next.splice(j, 1, parts[0], parts[1]);
      return next;
    });
    // Select the trailing half so the fresh cut is the visible selection.
    setSelectedClipId(parts[1].id);
  }, [clips, sealDiscrete]);

  // The clip-strip "+ Clip" tile opens the library browser (Upload new + reuse).
  const addClipClick = useCallback(() => setLibraryOpen('clip'), []);

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
      // Stickers / music need media first — open the asset-library browser, which
      // offers "Upload new" alongside previously-used assets to reuse.
      if (kind === 'sticker-image') {
        setLibraryOpen('sticker-image');
        return;
      }
      if (kind === 'sticker-video') {
        setLibraryOpen('sticker-video');
        return;
      }
      if (kind === 'music') {
        setLibraryOpen('music');
        return;
      }
      // Zoom / Time Machine are single-track: a repeat "+" edits the EXISTING
      // track, so a lock on it has to refuse here as well as on its row.
      if (kind === 'zoom' || kind === 'timemachine') {
        const track = kind === 'zoom' ? zoomLayer(projectRef.current) : timeMachineLayer(projectRef.current);
        if (track?.locked) {
          setStatus(`${track.name} is locked — unlock it in Layers (🔒) to add to it.`);
          return;
        }
      }
      sealDiscrete();
      const z = nextZ(projectRef.current);
      const outAR = out.w / out.h;

      if (kind === 'banner') {
        // Multi-instance: every "+" adds an independent banner. Default its freeze
        // to a clear spot after the last existing banner/Time Machine window so it
        // never conflicts (their freeze+hold windows must stay disjoint).
        const blocked = bannerBlockedSpans(projectRef.current);
        const lastEnd = blocked.reduce((m, s) => Math.max(m, s.end === Infinity ? m : s.end), 0);
        const wantFreeze =
          blocked.length > 0
            ? lastEnd + 0.1
            : mediaKind === 'video'
              ? Math.min(duration * 0.33, Math.max(0, duration - 0.2))
              : 1.5;
        const base = createBannerLayer(z);
        const cap = mediaKind === 'video' ? timelineDuration : Math.max(timelineDuration, 6);
        const fit = fitBannerFreeze(wantFreeze, base.hold, blocked, cap);
        const layer = createBannerLayer(z, { freeze: fit.freeze });
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setBannerConflict(null);
        seekTo(bannerPreviewTime(layer));
        return;
      }
      if (kind === 'zoom') {
        // Zoom is a single crop track. First "+" creates the (empty) track; a later
        // "+" drops another keyframe on the SAME track at the playhead, ready to edit.
        const existingZoom = zoomLayer(projectRef.current);
        if (existingZoom) {
          const total = mediaKind === 'video' ? timelineDuration : Math.max(timelineDuration, 6);
          const start = Math.max(0, Math.min(currentSec, Math.max(0, total - 0.5)));
          const kfDur = 1;
          const kf = createZoom({ start, duration: kfDur, rect: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } });
          setLayers((ls) => ls.map((l) => (l.id === existingZoom.id && l.kind === 'zoom' ? { ...l, keyframes: [...l.keyframes, kf] } : l)));
          setSelectedLayerId(existingZoom.id);
          setSelectedAttachmentId(null);
          setSelectedZoomKfId(kf.id);
          setEditingZoomBoth(true);
          const landing = Math.min(start + kfDur, total);
          compRef.current?.editZoomAt(landing);
          setCurrentSec(landing);
          return;
        }
        const layer = createZoomLayer(z);
        setLayers((ls) => [...ls, layer]);
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setSelectedZoomKfId(null);
        return;
      }
      if (kind === 'timemachine') {
        // Video-only (a still image has no playback speed to warp). One authoritative
        // speed curve: first "+" creates it; a later "+" drops another point on the
        // SAME curve at the playhead (keeping the curve shape — drag it afterwards).
        if (mediaKind !== 'video') return;
        const existingTm = timeMachineLayer(projectRef.current);
        if (existingTm) {
          const t = Math.max(0, Math.min(currentSec, timelineDuration));
          const speed = clampSpeed(speedAt(t, existingTm.points));
          setLayers((ls) => ls.map((l) => (l.id === existingTm.id && l.kind === 'timemachine' ? { ...l, points: [...l.points, { t, speed }] } : l)));
          clearZoomEdit();
          setSelectedLayerId(existingTm.id);
          setSelectedAttachmentId(null);
          setSelectedSpeedIdx(existingTm.points.length);
          seekTo(t);
          return;
        }
        const layer = createTimeMachineLayer(z);
        setLayers((ls) => [...ls, layer]);
        clearZoomEdit();
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setSelectedSpeedIdx(null);
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
      if (layer.el.kind === 'boil') {
        layer.el.end = start + 2;
        // Seed the new caption's own pool/normalize from the project defaults.
        layer.el.pool = boilPool;
        layer.el.normalize = normalize;
      }
      setLayers((ls) => [...ls, layer]);
      clearZoomEdit();
      setSelectedLayerId(layer.id);
      setSelectedAttachmentId(null);
      seekTo(midOfCaption(layer.el));
    },
    [mediaKind, duration, out, timelineDuration, currentSec, staggerStart, clearZoomEdit, seekTo, midOfCaption, bannerPreviewTime, sealDiscrete, boilPool, normalize],
  );

  /** Fit a source-aspect box into ~40% of the frame, centred (out-normalised). */
  const fitStickerBox = useCallback(
    (srcW: number, srcH: number) => {
      const aspect = srcH > 0 ? srcW / srcH : 1;
      let wPx = 0.4 * out.w;
      let hPx = wPx / aspect;
      if (hPx > 0.4 * out.h) {
        hPx = 0.4 * out.h;
        wPx = hPx * aspect;
      }
      const w = wPx / out.w;
      const h = hPx / out.h;
      return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
    },
    [out],
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

  /** Decode a sticker blob into an image / video element, then add the sticker
   *  under a fresh srcId. No library side effects (reused by library insert). */
  const ingestStickerBlob = useCallback(
    (blob: Blob, source: 'image' | 'video') => {
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      const srcId = freshId('stkmedia');
      stickerBlobs.current.set(srcId, blob);
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

  /** Decode a picked file into a sticker + auto-save the upload to the library. */
  const onStickerFile = useCallback(
    (file: File, source: 'image' | 'video') => {
      ingestStickerBlob(file, source);
      const name = file.name.replace(/\.[^./\\]+$/, '') || (source === 'video' ? 'Video sticker' : 'Image sticker');
      void saveUploadToLibrary(file, name, source === 'video' ? 'video' : 'image');
    },
    [ingestStickerBlob, saveUploadToLibrary],
  );

  const updateStickerEl = useCallback((id: string, patch: Partial<StickerElement>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'sticker' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  /** Register a decoded music track and add its layer, placed at the playhead. */
  const addMusicLayer = useCallback(
    (srcId: string, name: string, srcDuration: number) => {
      sealDiscrete();
      const z = nextZ(projectRef.current);
      const start = Math.max(0, Math.min(currentSec, Math.max(0, timelineDuration - 0.5)));
      const layer = createMusicLayer(z, { srcId, name, srcDuration }, start);
      setLayers((ls) => [...ls, layer]);
      clearZoomEdit();
      setSelectedLayerId(layer.id);
      setSelectedAttachmentId(null);
      setSelectedClipId(null);
    },
    [sealDiscrete, currentSec, timelineDuration, clearZoomEdit],
  );

  /** Decode a music blob into an <audio> element, then add the music layer under
   *  a fresh srcId. No library side effects (reused by library insert). */
  const ingestMusicBlob = useCallback(
    (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      const srcId = freshId('musmedia');
      musicBlobs.current.set(srcId, blob);
      const a = new Audio();
      a.src = url;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      const onReady = () => {
        a.removeEventListener('loadedmetadata', onReady);
        musicMedia.current.set(srcId, a);
        addMusicLayer(srcId, name, a.duration || 0);
      };
      a.addEventListener('loadedmetadata', onReady);
      a.addEventListener('error', () => setStatus('Could not load that audio file.'));
    },
    [addMusicLayer],
  );

  /** Decode a picked audio file into a music layer + auto-save it to the library. */
  const onMusicFile = useCallback(
    (file: File) => {
      const name = file.name.replace(/\.[^.]+$/, '') || 'Music';
      ingestMusicBlob(file, name);
      void saveUploadToLibrary(file, name, 'audio');
    },
    [ingestMusicBlob, saveUploadToLibrary],
  );

  const updateMusicEl = useCallback((id: string, patch: Partial<MusicElement>) => {
    setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'music' ? { ...l, el: { ...l.el, ...patch } } : l)));
  }, []);

  // ---- asset library: insert a COPY into the current project ----
  const insertFromLibrary = useCallback(
    (entry: LibraryEntry, intent: LibraryIntent) => {
      // The decode paths mint a fresh srcId and register the blob in this
      // project's media refs, so the project stays self-contained — deleting the
      // library entry later can never affect a project that already used it.
      if (intent === 'clip') ingestClipBlob(entry.blob, entry.name);
      else if (intent === 'sticker-image') ingestStickerBlob(entry.blob, 'image');
      else if (intent === 'sticker-video') ingestStickerBlob(entry.blob, 'video');
      else ingestMusicBlob(entry.blob, entry.name);
    },
    [ingestClipBlob, ingestStickerBlob, ingestMusicBlob],
  );

  /** "Upload new file" from within the browser → trigger the matching picker. */
  const libraryUploadNew = useCallback((intent: LibraryIntent) => {
    setLibraryOpen(null);
    if (intent === 'clip') clipInput.current?.click();
    else if (intent === 'sticker-image') stickerImageInput.current?.click();
    else if (intent === 'sticker-video') stickerVideoInput.current?.click();
    else musicInput.current?.click();
  }, []);

  const libraryPick = useCallback(
    (entry: LibraryEntry) => {
      const intent = libraryOpen;
      setLibraryOpen(null);
      if (intent) insertFromLibrary(entry, intent);
    },
    [libraryOpen, insertFromLibrary],
  );

  const libraryRename = useCallback(
    (id: string, name: string) => {
      void (async () => {
        try {
          await renameLibraryEntry(id, name);
          await refreshLibrary();
        } catch {
          /* ignore */
        }
      })();
    },
    [refreshLibrary],
  );

  const libraryDelete = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await deleteLibraryEntry(id);
          await refreshLibrary();
        } catch {
          /* ignore */
        }
      })();
    },
    [refreshLibrary],
  );

  const updateCaptionEl = useCallback((layerId: string, patch: Partial<Caption> | Partial<TypewriterCaption>) => {
    setLayers((ls) =>
      ls.map((l) => (l.id === layerId && l.kind === 'caption' ? { ...l, el: { ...l.el, ...patch } as CaptionEl } : l)),
    );
  }, []);

  // ---- find & replace across caption / typewriter text (current project) ----
  /** Every caption/typewriter element's live text, ordered by start time. */
  const captionsForFind = useMemo<CaptionText[]>(
    () =>
      layers
        .filter((l): l is CaptionLayer => l.kind === 'caption')
        .slice()
        .sort((a, b) => a.el.start - b.el.start)
        .map((l) => ({ id: l.id, text: l.el.text, label: l.el.text.split('\n')[0] || l.name })),
    [layers],
  );

  /** Replace one occurrence in a single caption — one undo entry. */
  const replaceOneCaption = useCallback(
    (layerId: string, at: number, search: string, replacement: string, caseSensitive: boolean) => {
      const src = projectRef.current.layers;
      const layer = src.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'caption') return;
      const next = replaceOneAt(layer.el.text, at, search, replacement, caseSensitive);
      if (next === null) return; // stale index — the text changed under us
      sealDiscrete();
      setLayers(src.map((l) => (l.id === layerId && l.kind === 'caption' ? { ...l, el: { ...l.el, text: next } as CaptionEl } : l)));
      setSelectedLayerId(layerId);
    },
    [sealDiscrete],
  );

  /** Replace EVERY occurrence across all captions in ONE undo step. Returns count. */
  const replaceAllCaptions = useCallback(
    (search: string, replacement: string, caseSensitive: boolean): number => {
      if (!search) return 0;
      const src = projectRef.current.layers;
      let count = 0;
      const next = src.map((l) => {
        if (l.kind !== 'caption') return l;
        const r = replaceAllInText(l.el.text, search, replacement, caseSensitive);
        if (r.n === 0) return l;
        count += r.n;
        return { ...l, el: { ...l.el, text: r.text } as CaptionEl };
      });
      if (count === 0) return 0;
      sealDiscrete(); // single seal + single setLayers → one undoable action
      setLayers(next);
      return count;
    },
    [sealDiscrete],
  );

  const updateBanner = useCallback(
    (id: string, patch: Partial<BannerLayer>) => {
      let applied = patch;
      // Freeze/hold shifts the frozen window, which must stay clear of every other
      // banner's window and every Time Machine warp — clamp it and flag conflicts.
      if (patch.freeze !== undefined || patch.hold !== undefined) {
        const cur = bannerLayers(projectRef.current).find((b) => b.id === id);
        if (cur) {
          const blocked = bannerBlockedSpans(projectRef.current, id);
          let conflicted = false;
          applied = { ...patch };
          if (patch.freeze !== undefined) {
            const fit = fitBannerFreeze(patch.freeze, patch.hold ?? cur.hold, blocked, timelineDuration);
            applied.freeze = fit.freeze;
            conflicted = fit.blocked;
          } else if (patch.hold !== undefined) {
            const fit = fitBannerHold(cur.freeze, patch.hold, blocked);
            applied.hold = fit.hold;
            conflicted = fit.blocked;
          }
          setBannerConflict(
            conflicted
              ? 'Freeze/hold can’t overlap another banner or a Time Machine warp — snapped to the nearest free spot.'
              : null,
          );
        }
      }
      setLayers((ls) => ls.map((l) => (l.id === id && l.kind === 'banner' ? { ...l, ...applied } : l)));
    },
    [timelineDuration],
  );

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

  /**
   * Toggle a layer's `hidden` / `locked` flag as its own undo entry. Written as
   * two explicit spreads rather than a computed key so each spread keeps its
   * layer variant (a computed key would collapse the discriminated union).
   */
  const toggleLayerFlag = useCallback(
    (id: string, flag: 'hidden' | 'locked') => {
      sealDiscrete();
      setLayers((ls) =>
        ls.map((l): Layer => {
          if (l.id !== id) return l;
          return flag === 'hidden' ? { ...l, hidden: !l.hidden } : { ...l, locked: !l.locked };
        }),
      );
    },
    [sealDiscrete],
  );

  const removeLayer = useCallback(
    (id: string) => {
      if (projectRef.current.layers.find((l) => l.id === id)?.locked) return;
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

  /** Duplicate any selected overlay layer with all its settings (Cmd/Ctrl+D). */
  const duplicateLayer = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      if (layer.kind === 'zoom' || layer.kind === 'timemachine') {
        setStatus('Zoom and Time Machine are single-track — add another keyframe/point with “+” instead.');
        return;
      }
      if (layer.kind === 'banner') {
        // Banners are multi-instance but their freeze+hold windows must not overlap —
        // drop the copy at the next clear spot after everything currently placed.
        const blocked = bannerBlockedSpans(projectRef.current);
        const lastEnd = blocked.reduce((m, s) => Math.max(m, s.end === Infinity ? m : s.end), 0);
        const cap = mediaKind === 'video' ? timelineDuration : Math.max(timelineDuration, 6);
        const fit = fitBannerFreeze(lastEnd + 0.1, layer.hold, blocked, cap);
        const clone = structuredClone(layer);
        clone.id = freshId('banner');
        clone.z = nextZ(projectRef.current);
        clone.freeze = fit.freeze;
        sealDiscrete();
        setLayers((ls) => [...ls, clone]);
        clearZoomEdit();
        setSelectedLayerId(clone.id);
        setSelectedAttachmentId(null);
        setBannerConflict(null);
        seekTo(bannerPreviewTime(clone));
        return;
      }
      if (layer.kind === 'music') {
        // A music layer owns a single <audio> element by srcId; two layers can't
        // share it. Add another track instead.
        setStatus('Add another music track with “+ Add” rather than duplicating.');
        return;
      }
      const clone = structuredClone(layer) as Extract<Layer, { el: unknown }>;
      clone.id = freshId(clone.kind);
      clone.z = nextZ(projectRef.current);
      clone.el.id = freshId('el');
      const nudge = (v: number) => Math.max(0.02, Math.min(0.95, v + 0.03));
      if (clone.kind === 'dramatic') {
        // Words never overlap in time — drop the copy into the first free gap.
        const gap = findDramaticGap(dramaticSpans(projectRef.current.layers), timelineDuration, clone.el.duration);
        if (!gap) {
          setStatus('No free timeline space to duplicate this word.');
          return;
        }
        clone.el.start = gap.start;
        clone.el.duration = Math.min(clone.el.duration, gap.duration);
      } else if (clone.kind === 'caption') {
        clone.el.x = nudge(clone.el.x);
        clone.el.y = nudge(clone.el.y);
        if (clone.el.kind === 'boil') {
          const len = clone.el.end - clone.el.start;
          const s = Math.min(clone.el.start + 0.3, Math.max(0, timelineDuration - len));
          clone.el.start = s;
          clone.el.end = s + len;
        } else {
          const total = clone.el.typingDur + clone.el.holdDur + (clone.el.deleteEnabled ? clone.el.deleteDur : 0);
          clone.el.start = Math.min(clone.el.start + 0.3, Math.max(0, timelineDuration - total));
        }
      } else {
        // sketch / highlighter / sticker: offset in time + on-canvas so it's visible.
        if ('x' in clone.el) {
          clone.el.x = nudge(clone.el.x);
          clone.el.y = nudge(clone.el.y);
        }
        clone.el.start = Math.min(clone.el.start + 0.3, Math.max(0, timelineDuration - 0.2));
      }
      sealDiscrete();
      setLayers((ls) => [...ls, clone]);
      clearZoomEdit();
      setSelectedLayerId(clone.id);
      setSelectedAttachmentId(null);
    },
    [layers, mediaKind, timelineDuration, sealDiscrete, clearZoomEdit, seekTo, bannerPreviewTime],
  );

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

  // ---- time-machine (free-form speed curve) ----
  const editTimeMachinePoints = useCallback((layerId: string, points: SpeedPoint[]) => {
    setLayers((ls) => ls.map((l) => (l.id === layerId && l.kind === 'timemachine' ? { ...l, points } : l)));
  }, []);

  const selectSpeedPoint = useCallback(
    (layerId: string, idx: number) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'timemachine') return;
      clearZoomEdit();
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(null);
      setSelectedSpeedIdx(idx);
      const p = layer.points[idx];
      if (p) seekTo(Math.min(Math.max(0, p.t), timelineDuration));
    },
    [layers, clearZoomEdit, seekTo, timelineDuration],
  );

  /** Click the lane → append a free point, select it, seek to it. */
  const addSpeedPoint = useCallback(
    (layerId: string, t: number, speed: number) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'timemachine') return;
      sealDiscrete();
      const next = [...layer.points, { t: Math.max(0, t), speed: clampSpeed(speed) }];
      editTimeMachinePoints(layerId, next);
      setSelectedLayerId(layerId);
      setSelectedAttachmentId(null);
      setSelectedSpeedIdx(next.length - 1);
      seekTo(Math.min(Math.max(0, t), timelineDuration));
    },
    [layers, sealDiscrete, editTimeMachinePoints, seekTo, timelineDuration],
  );

  /** Drag a point (continuous — the history debounce coalesces the burst). */
  const moveSpeedPoint = useCallback(
    (layerId: string, idx: number, t: number, speed: number) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'timemachine') return;
      editTimeMachinePoints(layerId, layer.points.map((p, i) => (i === idx ? { t: Math.max(0, t), speed: clampSpeed(speed) } : p)));
      setSelectedSpeedIdx(idx);
    },
    [layers, editTimeMachinePoints],
  );

  const removeSpeedPoint = useCallback(
    (layerId: string, idx: number) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== 'timemachine') return;
      sealDiscrete();
      editTimeMachinePoints(layerId, layer.points.filter((_, i) => i !== idx));
      setSelectedSpeedIdx(null);
    },
    [layers, sealDiscrete, editTimeMachinePoints],
  );

  const setSpeedPointSpeed = useCallback(
    (idx: number, speed: number) => {
      if (!timeMachine) return;
      editTimeMachinePoints(timeMachine.id, timeMachine.points.map((p, i) => (i === idx ? { ...p, speed: clampSpeed(speed) } : p)));
    },
    [timeMachine, editTimeMachinePoints],
  );

  /** Preset: drop a localised region (1× → held speed → 1×) at the playhead. */
  const addSpeedRegion = useCallback(
    (speed: number) => {
      if (!timeMachine) return;
      sealDiscrete();
      const start = Math.max(0, Math.min(currentSec, Math.max(0, timelineDuration - 0.3)));
      const ramp = speed <= 0.02 ? FREEZE_RAMP : REGION_RAMP;
      editTimeMachinePoints(timeMachine.id, applySpeedRegion(timeMachine.points, { start, speed, ramp, hold: REGION_HOLD }));
      setSelectedLayerId(timeMachine.id);
      setSelectedAttachmentId(null);
      setSelectedSpeedIdx(null);
      seekTo(Math.min(start + ramp + REGION_HOLD / 2, timelineDuration));
    },
    [timeMachine, currentSec, timelineDuration, sealDiscrete, editTimeMachinePoints, seekTo],
  );

  const clearSpeedCurve = useCallback(() => {
    if (!timeMachine) return;
    sealDiscrete();
    editTimeMachinePoints(timeMachine.id, []);
    setSelectedSpeedIdx(null);
  }, [timeMachine, sealDiscrete, editTimeMachinePoints]);

  const updateTimeMachine = useCallback((layerId: string, patch: Partial<TimeMachineLayer>) => {
    sealDiscrete();
    setLayers((ls) => ls.map((l) => (l.id === layerId && l.kind === 'timemachine' ? { ...l, ...patch } : l)));
  }, [sealDiscrete]);

  // ---- selecting a layer (list / timeline) ----
  const selectLayer = useCallback(
    (id: string) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer) return;
      setSelectedLayerId((prev) => {
        if (prev !== id) setBannerConflict(null); // drop a stale overlap note on switch
        return id;
      });
      setSelectedAttachmentId(null);
      setCroppingId((c) => (c === id ? c : null)); // leave crop mode when switching layers
      // A layer and a clip both own a transform widget, so selection is exclusive.
      setSelectedClipId(null);
      setCropClipId(null);
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
        setSelectedSpeedIdx(null);
        return;
      }
      setSelectedSpeedIdx(null);
      clearZoomEdit();
      if (layer.kind === 'banner') seekTo(bannerPreviewTime(layer));
      else if (layer.kind === 'caption') seekTo(midOfCaption(layer.el));
      else if (layer.kind === 'sketch') seekTo(layer.el.start + layer.el.animationDur + Math.min(0.3, layer.el.freezeDur / 2));
      else if (layer.kind === 'highlighter') seekTo(layer.el.start + Math.min(0.5, layer.el.duration / 2));
      else if (layer.kind === 'dramatic') seekTo(layer.el.start + Math.min(0.5, layer.el.duration / 2));
      else if (layer.kind === 'sticker') seekTo(layer.el.start + Math.min(0.5, layer.el.hold / 2));
    },
    [layers, selectZoomKf, clearZoomEdit, seekTo, midOfCaption, bannerPreviewTime],
  );

  // ---- playback (real play/pause toggle reflecting the compositor state) ----
  const play = useCallback(() => {
    stopShuttleLoop();
    transportRate.current = 1; // real forward is the 1x transport step
    setSelectedLayerId(null);
    setSelectedAttachmentId(null);
    setSelectedZoomKfId(null);
    setSelectedSpeedIdx(null);
    setEditingZoomBoth(false);
    // Resume from the current playhead rather than restarting at 0.
    compRef.current?.playPreview(currentSec);
    setIsPlaying(true);
  }, [currentSec, stopShuttleLoop]);

  /** Restart: jump the playhead to 0 and play from the top, whatever the current
   *  position or play state (distinct from play(), which resumes from the cursor). */
  const playFromStart = useCallback(() => {
    setSelectedLayerId(null);
    setSelectedAttachmentId(null);
    setSelectedZoomKfId(null);
    setSelectedSpeedIdx(null);
    setEditingZoomBoth(false);
    stopShuttleLoop();
    transportRate.current = 1;
    setCurrentSec(0);
    compRef.current?.playPreview(0);
    setIsPlaying(true);
  }, [stopShuttleLoop]);

  const pause = useCallback(() => {
    stopShuttleLoop();
    compRef.current?.stop();
    setIsPlaying(false);
  }, [stopShuttleLoop]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  // ---- J/K/L shuttle transport + arrow frame-step / nudge ----
  //
  // L = play forward, J = play backward, K = pause; repeated J/L accelerate
  // through 1x → 2x → 4x (NLE convention). Forward 1x reuses the real preview
  // (so audio plays); every other rate — accelerated forward or ANY backward —
  // is driven by a scrub-based shuttle loop (muted; reverse audio isn't
  // meaningful), advancing the playhead by rate·dt and seeking each frame.
  // (shuttleRAF / transportRate / stopShuttleLoop are declared up by seekTo.)
  const durationRef = useRef(timelineDuration);
  durationRef.current = timelineDuration;

  /** Halt every transport (real preview + shuttle) and settle paused. */
  const haltTransport = useCallback(() => {
    stopShuttleLoop();
    compRef.current?.stop();
    setIsPlaying(false);
  }, [stopShuttleLoop]);

  const runShuttle = useCallback((rate: number) => {
    stopShuttleLoop();
    compRef.current?.stop(); // take over from any real preview
    transportRate.current = rate;
    setIsPlaying(true);
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000); // clamp long frames
      last = now;
      const cur = compRef.current?.currentTimeSec() ?? 0;
      const total = Math.max(0.001, durationRef.current);
      let next = cur + transportRate.current * dt;
      let hitEnd = false;
      if (next <= 0) { next = 0; hitEnd = transportRate.current < 0; }
      if (next >= total) { next = total; hitEnd = transportRate.current > 0; }
      setCurrentSec(next);
      compRef.current?.scrubTo(next);
      if (hitEnd) { // ran off the start / end — settle paused there
        transportRate.current = 0;
        shuttleRAF.current = null;
        setIsPlaying(false);
        return;
      }
      shuttleRAF.current = requestAnimationFrame(tick);
    };
    shuttleRAF.current = requestAnimationFrame(tick);
  }, [stopShuttleLoop]);

  /** L: start / accelerate forward. First forward step is real 1x playback. */
  const shuttleForward = useCallback(() => {
    setSelectedLayerId(null);
    setSelectedAttachmentId(null);
    const r = transportRate.current;
    if (r <= 0) {
      // From paused or reverse → real 1x forward (with audio).
      stopShuttleLoop();
      transportRate.current = 1;
      play();
    } else {
      // Already forward → 1x(real) → 2x → 4x via the shuttle.
      runShuttle(Math.min(4, r * 2));
    }
  }, [play, runShuttle, stopShuttleLoop]);

  /** J: start / accelerate backward (always shuttle; no reverse audio). */
  const shuttleBackward = useCallback(() => {
    setSelectedLayerId(null);
    setSelectedAttachmentId(null);
    const r = transportRate.current;
    runShuttle(r >= 0 ? -1 : Math.max(-4, r * 2));
  }, [runShuttle]);

  /** Step the playhead by exactly `dir` editing frames (halts any transport). */
  const stepFrame = useCallback(
    (dir: number) => {
      haltTransport();
      const cur = compRef.current?.currentTimeSec() ?? currentSec;
      const next = Math.max(0, Math.min(timelineDuration, cur + dir * FRAME_SEC));
      seekTo(next);
    },
    [haltTransport, currentSec, timelineDuration, seekTo],
  );

  // ---- timeline markers (labelled instants on the output clock) ----
  //
  // Markers are project data like everything else, so every mutation goes through
  // the same snapshot history: label / colour / time-field edits seal their own
  // undo entry, while a pin DRAG streams unsealed so the history debounce
  // coalesces the burst into one step (the pattern the speed curve and volume
  // curves already use).

  /** Drop a marker at the playhead. Refuses a second marker at the same instant. */
  const addMarkerAt = useCallback(
    (t: number) => {
      if (!mediaKind) return;
      const at = Math.max(0, Math.min(t, timelineDuration));
      const existing = markerAt(markers, at);
      if (existing) {
        setSelectedMarkerId(existing.id);
        setStatus('There is already a marker here.');
        return;
      }
      sealDiscrete();
      const m = createMarker(at, markers.length);
      setMarkers((ms) => [...ms, m]);
      setSelectedMarkerId(m.id);
      setStatus(`Marker at ${at.toFixed(2)}s. Rename it in the Markers panel.`);
    },
    [mediaKind, timelineDuration, markers, sealDiscrete],
  );

  const addMarkerAtPlayhead = useCallback(() => {
    addMarkerAt(compRef.current?.currentTimeSec() ?? currentSec);
  }, [addMarkerAt, currentSec]);

  const editMarker = useCallback(
    (id: string, patch: Partial<Marker>, discrete = false) => {
      if (discrete) sealDiscrete();
      setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [sealDiscrete],
  );

  /** Streamed pin drag — clamped to the timeline, no seal (see the note above). */
  const moveMarker = useCallback((id: string, t: number) => {
    setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, t: Math.max(0, t) } : m)));
    setSelectedMarkerId(id);
  }, []);

  const removeMarker = useCallback(
    (id: string) => {
      sealDiscrete();
      setMarkers((ms) => ms.filter((m) => m.id !== id));
      setSelectedMarkerId((cur) => (cur === id ? null : cur));
    },
    [sealDiscrete],
  );

  /** Select a marker and park the playhead on it. */
  const selectMarker = useCallback(
    (id: string) => {
      setSelectedMarkerId(id);
      const m = markers.find((x) => x.id === id);
      if (m) seekTo(Math.max(0, Math.min(m.t, timelineDuration)));
    },
    [markers, seekTo, timelineDuration],
  );

  /** ⌥← / ⌥→ : walk the playhead to the previous / next marker. */
  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      const from = compRef.current?.currentTimeSec() ?? currentSec;
      const m = stepMarker(markers, from, dir);
      if (!m) {
        setStatus(dir === 1 ? 'No marker after the playhead.' : 'No marker before the playhead.');
        return;
      }
      haltTransport();
      setSelectedMarkerId(m.id);
      seekTo(Math.max(0, Math.min(m.t, timelineDuration)));
    },
    [markers, currentSec, haltTransport, seekTo, timelineDuration],
  );

  /**
   * Nudge the selected placeable overlay's on-canvas position (normalised).
   * Applies the delta inside a functional setLayers updater — NOT from a captured
   * `el.x/el.y` — so a fast burst of key-repeat presses accumulates on the latest
   * state instead of collapsing to a single step. Coalesces into one undo entry.
   */
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const id = selectedLayerId;
      if (!id) return;
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      setLayers((ls) =>
        ls.map((l): Layer => {
          if (l.id !== id) return l;
          // Narrow per kind (separate returns) so each el spread keeps its type.
          switch (l.kind) {
            case 'caption':
              return { ...l, el: { ...l.el, x: clamp01(l.el.x + dx), y: clamp01(l.el.y + dy) } };
            case 'sketch':
              return { ...l, el: { ...l.el, x: clamp01(l.el.x + dx), y: clamp01(l.el.y + dy) } };
            case 'highlighter':
              return { ...l, el: { ...l.el, x: clamp01(l.el.x + dx), y: clamp01(l.el.y + dy) } };
            case 'dramatic':
              return { ...l, el: { ...l.el, x: clamp01(l.el.x + dx), y: clamp01(l.el.y + dy) } };
            case 'sticker':
              return { ...l, el: { ...l.el, x: clamp01(l.el.x + dx), y: clamp01(l.el.y + dy) } };
            default:
              return l;
          }
        }),
      );
    },
    [selectedLayerId],
  );

  // Tear down the shuttle loop on unmount.
  useEffect(() => () => stopShuttleLoop(), [stopShuttleLoop]);

  const onScrub = useCallback(
    (sec: number) => {
      setCurrentSec(sec);
      stopShuttleLoop();
      if (editingRef.current) compRef.current?.editZoomAt(sec);
      else {
        compRef.current?.scrubTo(sec); // scrubbing stops playback
        setIsPlaying(false);
      }
    },
    [stopShuttleLoop],
  );

  // ---- keyboard: spacebar play/pause, Cmd/Ctrl+D duplicate, Escape exits full-screen ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmDeleteId) return;
      const editable = isEditableTarget(e);
      const mod = hasMod(e);

      // Spacebar toggles preview — but never while typing in a field.
      if ((e.key === ' ' || e.code === 'Space') && !editable && !mod) {
        if (!mediaKind) return;
        e.preventDefault();
        togglePlay();
        return;
      }
      // Cmd/Ctrl+D duplicates the selected layer, or the selected clip if no layer.
      if (mod && (e.key === 'd' || e.key === 'D')) {
        if (editable) return;
        e.preventDefault();
        if (selectedLayerId) duplicateLayer(selectedLayerId);
        else if (selectedClipId) duplicateClip(selectedClipId);
        return;
      }
      // Cmd/Ctrl+C copies the selected clip; Cmd/Ctrl+V pastes it after the
      // selection (never while typing, and only when a clip — not a layer — is
      // the active selection, so text-field copy/paste is untouched).
      if (mod && (e.key === 'c' || e.key === 'C') && !editable && !selectedLayerId && selectedClipId) {
        e.preventDefault();
        copyClip(selectedClipId);
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V') && !editable && !selectedLayerId && clipClipboard.current) {
        e.preventDefault();
        pasteClip();
        return;
      }
      // 'S' splits the clip under the playhead (NLE razor convention).
      if ((e.key === 's' || e.key === 'S') && !editable && !mod) {
        if (!mediaKind) return;
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      // 'M' drops a marker at the playhead (the NLE convention).
      if ((e.key === 'm' || e.key === 'M') && !editable && !mod && !e.altKey) {
        if (!mediaKind) return;
        e.preventDefault();
        addMarkerAtPlayhead();
        return;
      }
      // ⌥←/⌥→ walks the playhead between markers. Checked BEFORE the plain-arrow
      // branch below, which would otherwise swallow it (Alt isn't part of `mod`).
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && !editable && !mod) {
        if (!mediaKind) return;
        e.preventDefault();
        jumpMarker(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      // Arrows: selection-aware. A placeable element selected → nudge its
      // on-canvas position (Shift = bigger jump); otherwise Left/Right frame-step
      // the playhead by one editing frame (Up/Down ignored — the playhead is 1-D).
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !editable &&
        !mod
      ) {
        if (!mediaKind) return;
        if (isPlaceable(selectedLayer) && !selectedLayer.locked) {
          e.preventDefault();
          const s = e.shiftKey ? 0.02 : 0.004; // normalised nudge step
          if (e.key === 'ArrowLeft') nudgeSelected(-s, 0);
          else if (e.key === 'ArrowRight') nudgeSelected(s, 0);
          else if (e.key === 'ArrowUp') nudgeSelected(0, -s);
          else nudgeSelected(0, s);
          return;
        }
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
        return;
      }
      // J / K / L shuttle transport (guard auto-repeat so held J/L don't
      // race through the speed steps; K is idempotent).
      if ((e.key === 'j' || e.key === 'J') && !editable && !mod) {
        if (!mediaKind || e.repeat) return;
        e.preventDefault();
        shuttleBackward();
        return;
      }
      if ((e.key === 'k' || e.key === 'K') && !editable && !mod) {
        if (!mediaKind) return;
        e.preventDefault();
        haltTransport();
        return;
      }
      if ((e.key === 'l' || e.key === 'L') && !editable && !mod) {
        if (!mediaKind || e.repeat) return;
        e.preventDefault();
        shuttleForward();
        return;
      }
      // Escape leaves full-screen (crop-escape is owned by the other handler,
      // and an open toolbar menu gets the first Escape to itself).
      if (e.key === 'Escape' && fullscreen && !croppingId && !menuOpenRef.current) {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    togglePlay, duplicateLayer, selectedLayerId, fullscreen, croppingId, confirmDeleteId, mediaKind,
    splitAtPlayhead, selectedLayer, nudgeSelected, stepFrame, shuttleBackward, shuttleForward, haltTransport,
    selectedClipId, duplicateClip, copyClip, pasteClip, addMarkerAtPlayhead, jumpMarker,
  ]);

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

  /**
   * Double-click to crop. A sticker under the pointer wins (its own crop mode);
   * otherwise the double-click belongs to the CLIP under the pointer.
   *
   * Clips add one behaviour stickers deliberately don't have: double-clicking a
   * clip that ALREADY carries a crop, while not currently cropping it, resets that
   * crop to the full source — a one-click "undo the crop". Otherwise it toggles
   * crop-adjust mode as a sticker does.
   */
  const onCanvasDoubleClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (editingRef.current) return;
      const c = compRef.current;
      if (!c) return;
      const { nx, ny } = normFromPointer(e.clientX, e.clientY);
      const hit = c.hitTestDraggable(nx, ny);
      const target = hit ?? (selectedLayer?.kind === 'sticker' ? selectedLayer.id : null);
      const layer = target ? layers.find((l) => l.id === target) : null;
      if (layer && layer.kind === 'sticker' && !layer.locked && !layer.hidden) {
        setSelectedLayerId(layer.id);
        setSelectedAttachmentId(null);
        setCroppingId((cur) => (cur === layer.id ? null : layer.id));
        return;
      }
      if (hit) return; // some other overlay owns this pixel — leave it alone

      const clip = clips.find((x) => x.id === (c.hitTestClip(nx, ny) ?? selectedClipId));
      if (!clip) return;
      setSelectedLayerId(null);
      setSelectedAttachmentId(null);
      setSelectedClipId(clip.id);
      if (isBlank(clip)) return; // no source to pick a region of
      if (cropClipId === clip.id) setCropClipId(null); // done cropping
      else if (hasUserCrop(clip)) uncropClip(clip); // one-click un-crop
      else setCropClipId(clip.id);
    },
    [normFromPointer, layers, selectedLayer, clips, selectedClipId, cropClipId, hasUserCrop, uncropClip],
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
    setSelectedSpeedIdx(null);
    setEditingZoomBoth(false);
    setIsPlaying(false);
    setDownloadUrl(null);
    setStage('recording');
    setProgress(0);
    setStatus('Recording the composite in real time…');
    try {
      const total = c.totalSec();
      const rec = await c.record((sec) => setProgress(Math.min(0.99, sec / Math.max(0.1, total))));
      let outBlob: Blob = rec.blob;
      let ext = rec.mime.includes('mp4') ? 'mp4' : 'webm';
      let type = ext === 'mp4' ? 'video/mp4' : 'video/webm';
      if (ext !== 'mp4') {
        // Browser couldn't record H.264/MP4 natively (Firefox): transcode the
        // VP9/WebM once. When we DID record MP4 directly it's a single encode —
        // no generational loss — so we skip ffmpeg entirely.
        try {
          setStage('preparing');
          setStatus('Preparing the MP4 encoder (one-time download)…');
          await ensureFFmpeg();
          setStage('encoding');
          setStatus('Encoding MP4 (H.264)…');
          setProgress(0);
          outBlob = await transcodeToMp4(rec.blob, (p) => setProgress(p));
          ext = 'mp4';
          type = 'video/mp4';
        } catch (err) {
          console.error('MP4 transcode failed, falling back to WebM', err);
          setStatus('MP4 encoding failed — providing the WebM instead.');
        }
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

  // ---- project persistence (lossless local autosave + JSON save/load) ----
  const hydratedRef = useRef(false);
  /** srcIds whose original blob is already persisted to IndexedDB (skip re-writes). */
  const persistedRef = useRef<Set<string>>(new Set());

  const currentSnapshot = useCallback(
    (): PersistSnapshot => ({
      version: 1,
      clips,
      layers,
      ratio,
      fillMode,
      boilPool,
      normalize,
      sfxEnabled,
      sfxVolume,
      imageDuration,
      grade: globalGrade,
      markers,
    }),
    [clips, layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, globalGrade, markers],
  );

  const blobForSrc = useCallback(
    (srcId: string) => clipBlobs.current.get(srcId) ?? stickerBlobs.current.get(srcId) ?? musicBlobs.current.get(srcId),
    [],
  );

  /** Every referenced source as a MediaEntry (original blob, verbatim). */
  const collectMedia = useCallback((snapshot: PersistSnapshot): MediaEntry[] => {
    const out: MediaEntry[] = [];
    for (const srcId of referencedSrcIds(snapshot)) {
      const blob = blobForSrc(srcId);
      if (!blob) continue;
      const clip = snapshot.clips.find((c) => c.srcId === srcId);
      out.push({ srcId, name: clip?.name ?? 'sticker', type: blob.type || 'application/octet-stream', blob });
    }
    return out;
  }, [blobForSrc]);

  /** Rebuild the decoded <video>/<img> elements from stored blobs, then set state. */
  const applyLoadedProject = useCallback(async (loaded: LoadedProject) => {
    const bySrc = new Map(loaded.media.map((m) => [m.srcId, m]));
    const decodeVideo = (url: string, sticker: boolean) => {
      const v = document.createElement('video');
      v.src = url;
      v.playsInline = true;
      v.preload = 'auto';
      if (sticker) {
        v.muted = true;
        v.loop = true;
      } else {
        v.crossOrigin = 'anonymous';
      }
      return new Promise<HTMLVideoElement>((res) => {
        v.addEventListener('loadedmetadata', () => res(v), { once: true });
        v.addEventListener('error', () => res(v), { once: true });
      });
    };
    const decodeImage = (url: string) =>
      new Promise<HTMLImageElement>((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(img);
        img.src = url;
      });

    for (const clip of loaded.snapshot.clips) {
      const m = bySrc.get(clip.srcId);
      if (!m) continue;
      clipBlobs.current.set(clip.srcId, m.blob);
      const url = URL.createObjectURL(m.blob);
      objectUrls.current.push(url);
      clipMedia.current.set(clip.srcId, clip.kind === 'video' ? await decodeVideo(url, false) : await decodeImage(url));
    }
    for (const layer of loaded.snapshot.layers) {
      if (layer.kind !== 'sticker') continue;
      const m = bySrc.get(layer.el.srcId);
      if (!m) continue;
      stickerBlobs.current.set(layer.el.srcId, m.blob);
      const url = URL.createObjectURL(m.blob);
      objectUrls.current.push(url);
      stickerMedia.current.set(layer.el.srcId, layer.el.source === 'video' ? await decodeVideo(url, true) : await decodeImage(url));
    }
    for (const layer of loaded.snapshot.layers) {
      if (layer.kind !== 'music') continue;
      const m = bySrc.get(layer.el.srcId);
      if (!m) continue;
      musicBlobs.current.set(layer.el.srcId, m.blob);
      const url = URL.createObjectURL(m.blob);
      objectUrls.current.push(url);
      const a = new Audio();
      a.src = url;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      await new Promise<void>((res) => {
        a.addEventListener('loadedmetadata', () => res(), { once: true });
        a.addEventListener('error', () => res(), { once: true });
      });
      musicMedia.current.set(layer.el.srcId, a);
    }

    const s = loaded.snapshot;
    setClips(s.clips);
    setLayers(s.layers);
    setRatio(s.ratio);
    setFillMode(s.fillMode);
    setBoilPool(s.boilPool);
    setNormalize(s.normalize);
    setSfxEnabled(s.sfxEnabled);
    setSfxVolume(s.sfxVolume);
    setImageDuration(s.imageDuration);
    setGlobalGrade(s.grade ?? NEUTRAL_GRADE);
    setMarkers(s.markers ?? []);
    setSelectedMarkerId(null);
    setSelectedLayerId(null);
    setSelectedClipId(null);
    setSelectedAttachmentId(null);
  }, []);

  // Restore an autosaved project once, on mount ("refresh doesn't lose work").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadProject();
        if (!cancelled && loaded) {
          await applyLoadedProject(loaded);
          persistedRef.current = referencedSrcIds(loaded.snapshot);
          setStatus('Restored your last project from this browser. (Save a JSON copy to back it up.)');
        }
      } catch {
        /* IndexedDB unavailable (e.g. private mode) — start fresh. */
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedProject]);

  // Debounced autosave: write the snapshot on every edit + newly-seen media once.
  // Drives the top-bar indicator: 'saving' while an edit is pending/writing,
  // 'saved' once the write lands.
  useEffect(() => {
    if (!hydratedRef.current || clips.length === 0) return;
    const snapshot = currentSnapshot();
    setSaveState('saving');
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          await saveSnapshot(snapshot);
          const ids = referencedSrcIds(snapshot);
          for (const srcId of ids) {
            if (persistedRef.current.has(srcId)) continue;
            const blob = blobForSrc(srcId);
            if (!blob) continue;
            const clip = snapshot.clips.find((c) => c.srcId === srcId);
            await saveMedia({ srcId, name: clip?.name ?? 'sticker', type: blob.type || 'application/octet-stream', blob });
            persistedRef.current.add(srcId);
          }
          await pruneMedia(ids);
          for (const srcId of [...persistedRef.current]) if (!ids.has(srcId)) persistedRef.current.delete(srcId);
          setSaveState('saved');
        } catch {
          /* storage full / unavailable — drop back to idle rather than hang on "Saving…" */
          setSaveState('idle');
        }
      })();
    }, 800);
    return () => window.clearTimeout(id);
  }, [clips, layers, ratio, fillMode, boilPool, normalize, sfxEnabled, sfxVolume, imageDuration, markers, currentSnapshot, blobForSrc]);

  const saveProjectFile = useCallback(async () => {
    const snapshot = currentSnapshot();
    try {
      const blob = await exportProjectJSON(snapshot, collectMedia(snapshot));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project.fyrebolt.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus('Saved a project JSON (media embedded losslessly).');
    } catch {
      setStatus('Could not save the project file.');
    }
  }, [currentSnapshot, collectMedia]);

  const loadProjectFile = useCallback(
    async (file: File) => {
      try {
        const loaded = await importProjectJSON(file);
        await applyLoadedProject(loaded);
        persistedRef.current = new Set(); // force the loaded media to re-persist to IDB
        setStatus('Project loaded from file.');
      } catch {
        setStatus('That file is not a valid Fyrebolt project.');
      }
    },
    [applyLoadedProject],
  );

  const clearAutosave = useCallback(async () => {
    try {
      await clearProject();
      persistedRef.current = new Set();
      setSaveState('idle');
      setStatus('Cleared the autosaved project from this browser.');
    } catch {
      /* ignore */
    }
  }, []);

  // The draggable crop rect — withheld while the zoom track is locked or hidden.
  const selectedZoomRect =
    editingZoom && selectedLayer?.kind === 'zoom' && !selectedLayer.locked && !selectedLayer.hidden
      ? selectedLayer.keyframes.find((k) => k.id === selectedZoomKfId)?.rect ?? null
      : null;

  // Measured placement boxes for every placeable layer (pure — no compositor ref).
  // Hidden layers are excluded (nothing is on screen to point at); locked ones stay
  // in, so they still serve as snap targets for the layers you can move.
  const placeableBoxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const l of layers) {
      if (!isPlaceable(l) || l.hidden) continue;
      const b = measurePlaceableBox(l, out, currentSec);
      if (b) m[l.id] = b;
    }
    return m;
  }, [layers, out, currentSec]);
  const selBox = selectedLayer && isPlaceable(selectedLayer) ? placeableBoxes[selectedLayer.id] ?? null : null;

  // A clip is a transformable object too, so it gets the same treatment: its box
  // drives its transform widget and serves as a snap target for everything else.
  // Only clips LIVE at the cursor count — an off-screen clip must not throw guides.
  const clipBoxes = useMemo(() => {
    const m: Record<string, Transform> = {};
    for (const c of clips) m[c.id] = placementOf(c).transform;
    return m;
  }, [clips, placementOf]);
  const selClipPlacement = selectedClip ? placementOf(selectedClip) : null;
  const liveClipIds = useMemo(
    () => new Set(clipExtents.filter((e) => currentSec >= e.start && currentSec < e.end).map((e) => e.id)),
    [clipExtents, currentSec],
  );

  const otherBoxes = useMemo(() => {
    const boxes: Box[] = [];
    for (const [id, b] of Object.entries(placeableBoxes)) if (id !== selectedLayerId) boxes.push(b);
    for (const [id, b] of Object.entries(clipBoxes)) {
      if (id === selectedClipId || !liveClipIds.has(id)) continue;
      // A clip still filling the whole frame is the frame border, which `border`
      // snapping already provides — skip it rather than duplicate the lines.
      if (b.x === 0 && b.y === 0 && b.w === 1 && b.h === 1) continue;
      boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
    return boxes;
  }, [placeableBoxes, selectedLayerId, clipBoxes, selectedClipId, liveClipIds]);

  /** Locked layer ids — a set, because the pointer paths test membership per event. */
  const lockedIds = useMemo(() => new Set(layers.filter((l) => l.locked).map((l) => l.id)), [layers]);

  // Effective group selection: the raw group only counts when it still holds the
  // primary and has >1 member; otherwise selection is just the primary layer.
  // Locked members drop out, so a group move never drags a protected layer.
  const groupSel = useMemo(() => {
    if (selectedLayerId && groupIds.length > 1 && groupIds.includes(selectedLayerId)) {
      return groupIds.filter((id) => placeableBoxes[id] && !lockedIds.has(id));
    }
    return selectedLayerId ? [selectedLayerId] : [];
  }, [groupIds, selectedLayerId, placeableBoxes, lockedIds]);
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
          else if (layer.kind === 'sticker') updateStickerEl(it.id, pos);
          else if (layer.kind === 'caption') updateCaptionEl(it.id, pos);
          else updateDramaticEl(it.id, pos);
        }
      }
    },
    [normFromPointer, groupBox, effectiveGuides, otherBoxes, layers, updateSketchEl, updateHighlighterEl, updateStickerEl, updateCaptionEl, updateDramaticEl],
  );

  const onCanvasPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (marqueeStart.current && marquee) {
        // Commit the marquee: select every UNLOCKED placeable box it intersects.
        const m = marquee;
        const hit: string[] = [];
        for (const [id, b] of Object.entries(placeableBoxes)) {
          if (lockedIds.has(id)) continue;
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
    [marquee, placeableBoxes, lockedIds],
  );

  // How much viewport height the preview may claim. Inside the iPad frame the
  // scrollable pane is only ~80dvh of the window, so it gets the smaller share.
  const previewMaxVh = fullscreen ? '52vh' : '30vh';

  const editorBody = (
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
              {/* Autosave state lives with the title — it describes this project,
                  and no longer costs a full row of its own above the editor. */}
              <span className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium" aria-live="polite">
                {saveState === 'saving' ? (
                  <>
                    <svg className="animate-spin text-[var(--color-accent)]" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span className="text-[var(--color-text-secondary)] hidden sm:inline">Saving…</span>
                  </>
                ) : saveState === 'saved' ? (
                  <>
                    <span className="text-[var(--color-primary-green)] leading-none" aria-hidden>✓</span>
                    <span className="text-[var(--color-text-muted)] hidden sm:inline">Saved</span>
                  </>
                ) : null}
              </span>
            </div>
            <div className="justify-self-end inline-flex items-center gap-1">
              {/* Project file actions — one menu instead of three always-on buttons. */}
              <div className="relative" data-menu>
                <button
                  onClick={() => { setProjectMenuOpen((v) => !v); setAddOpen(false); setGearOpen(false); }}
                  aria-expanded={projectMenuOpen}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-2 py-1.5 rounded-lg hover:bg-[rgba(0,122,255,0.08)] transition-colors"
                >
                  <span>Project</span>
                  <span className="text-[9px]" aria-hidden>▾</span>
                </button>
                {projectMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-glass-border)] overflow-hidden z-30 py-1">
                    <MenuItem
                      onClick={() => { setProjectMenuOpen(false); saveProjectFile(); }}
                      disabled={!mediaKind || busy}
                      icon="↓"
                      label="Save project file"
                      hint="JSON backup, media embedded"
                    />
                    <MenuItem
                      onClick={() => { setProjectMenuOpen(false); projectInput.current?.click(); }}
                      disabled={busy}
                      icon="↑"
                      label="Load project file"
                    />
                    <MenuItem
                      onClick={() => { setProjectMenuOpen(false); setLibraryOpen('clip'); }}
                      disabled={busy}
                      icon="📚"
                      label="Asset library"
                      hint="Reuse clips across projects"
                    />
                    <div className="my-1 border-t border-[var(--color-glass-border)]" />
                    <MenuItem
                      onClick={() => { setProjectMenuOpen(false); clearAutosave(); }}
                      icon="🗑"
                      label="Clear autosave"
                      danger
                    />
                  </div>
                )}
              </div>
              <button
                onClick={() => setFullscreen((v) => !v)}
                title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-2 py-1.5 rounded-lg hover:bg-[rgba(0,122,255,0.08)] transition-colors"
              >
                <span aria-hidden>{fullscreen ? '🡿' : '⛶'}</span>
                <span className="hidden sm:inline">{fullscreen ? 'Exit' : 'Full screen'}</span>
              </button>
              <a href="/video-classic/" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] font-mono hidden lg:block ml-1">
                classic ↗
              </a>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-5 pt-4 pb-8">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
            {/* ---- Preview + timeline ---- */}
            <section>
              {/* The drop target is the empty state ONLY. Once there are clips the
                  canvas itself accepts drops and the clip strip carries ＋Clip /
                  ⬛Blank / 📚Library tiles, so this card would be a third copy of
                  the same action sitting permanently above the fold. */}
              {clips.length === 0 && (
                <>
                  <label
                    onDragOver={onDragOverFiles}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDropFiles}
                    className={`block glass-card mb-3 cursor-pointer text-center border-2 border-dashed rounded-xl px-4 py-7 transition-colors ${
                      dragOver
                        ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]'
                        : 'border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]'
                    }`}
                  >
                    <div className="text-2xl mb-1" aria-hidden>
                      {dragOver ? '⬇️' : '🎞️'}
                    </div>
                    <div className="text-sm font-medium">{dragOver ? 'Drop to upload' : 'Drag & drop a photo or video'}</div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">or click to browse</div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        for (const f of Array.from(e.target.files ?? [])) onFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setLibraryOpen('clip')}
                    className="mb-4 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
                  >
                    <span aria-hidden>📚</span> …or reuse a clip from your library
                  </button>
                </>
              )}

              {/* Hidden input used by the clip strip's "+ Clip" tile. */}
              <input
                ref={clipInput}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />

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

              {/* Hidden input for adding a background-music track. */}
              <input
                ref={musicInput}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onMusicFile(f);
                  e.target.value = '';
                }}
              />

              {/* Hidden input for loading a saved project JSON. */}
              <input
                ref={projectInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadProjectFile(f);
                  e.target.value = '';
                }}
              />

              <div className="glass-card p-3">
                {/* ---- Transport + tools: one sticky bar, above the preview ----
                    Everything here used to sit BELOW the canvas, which on a 9:16
                    project put Play / Split / Export off the bottom of the screen
                    at all times. Sticking it to the top of the preview card keeps
                    the whole verb set reachable however far you scroll. */}
                <div className="sticky top-[68px] z-30 -mx-3 -mt-3 mb-3 px-3 py-2 rounded-t-[inherit] bg-[var(--color-bg-surface)]/85 backdrop-blur border-b border-[var(--color-glass-border)] flex flex-wrap items-center gap-1.5">
                  <button onClick={playFromStart} disabled={!mediaKind || busy} title="Restart from the beginning" aria-label="Restart" className={TOOL_BTN}>
                    ⏮
                  </button>
                  <button
                    onClick={togglePlay}
                    disabled={!mediaKind || busy}
                    title="Play / pause (Space)"
                    className="tool-btn px-3.5 py-1.5 rounded-md text-sm min-w-[86px]"
                  >
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button onClick={splitAtPlayhead} disabled={!mediaKind || busy} title="Split the clip under the playhead (S)" aria-label="Split" className={TOOL_BTN}>
                    ✂
                  </button>

                  <span className="w-px self-stretch my-0.5 bg-[var(--color-glass-border)]" aria-hidden />

                  <button onClick={undo} disabled={!history.canUndo || busy} title="Undo (⌘Z / Ctrl+Z)" aria-label="Undo" className={TOOL_BTN}>
                    ↶
                  </button>
                  <button onClick={redo} disabled={!history.canRedo || busy} title="Redo (⇧⌘Z / Ctrl+Y)" aria-label="Redo" className={TOOL_BTN}>
                    ↷
                  </button>
                  <button
                    onClick={() => selectedLayerId && duplicateLayer(selectedLayerId)}
                    disabled={!selectedLayerId || busy}
                    title="Duplicate the selected layer (⌘D / Ctrl+D)"
                    aria-label="Duplicate selected layer"
                    className={TOOL_BTN}
                  >
                    ⧉
                  </button>

                  <span className="w-px self-stretch my-0.5 bg-[var(--color-glass-border)]" aria-hidden />

                  {/* Add layer — the single entry point. The canvas no longer
                      carries a duplicate "+" bubble over the footage. */}
                  <div className="relative" data-menu>
                    <button
                      onClick={() => { setAddOpen((v) => !v); setGearOpen(false); setProjectMenuOpen(false); }}
                      disabled={!mediaKind || busy}
                      aria-expanded={addOpen}
                      className="px-3 py-1.5 rounded-md bg-[var(--color-primary-green)] text-black disabled:opacity-40 text-sm font-semibold"
                    >
                      + Add <span className="text-[9px]" aria-hidden>▾</span>
                    </button>
                    {addOpen && (
                      <div className="absolute left-0 mt-1.5 w-56 max-h-[60vh] overflow-y-auto rounded-xl bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-glass-border)] z-40 py-1">
                        {ADD_GROUPS.map((g) => (
                          <div key={g.group}>
                            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                              {g.group}
                            </div>
                            {g.items.map((it) => {
                              // Zoom / Time Machine are single-track: a repeat add
                              // drops another keyframe / point rather than a layer.
                              const tmUnavailable = it.kind === 'timemachine' && mediaKind !== 'video';
                              const hint = tmUnavailable
                                ? 'video only'
                                : it.kind === 'zoom' && !!zoom
                                  ? 'add keyframe'
                                  : it.kind === 'timemachine' && !!timeMachine
                                    ? 'add point'
                                    : undefined;
                              return (
                                <MenuItem
                                  key={it.kind}
                                  onClick={() => addLayer(it.kind)}
                                  disabled={tmUnavailable}
                                  icon={it.icon}
                                  label={it.label}
                                  hint={hint}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* View options: guides, snapping, safe zones — all the canvas
                      overlays in one place (they used to be split between a gear
                      bubble on the canvas and checkboxes in the Output panel). */}
                  <div className="relative" data-menu>
                    <button
                      onClick={() => { setGearOpen((v) => !v); setAddOpen(false); setProjectMenuOpen(false); }}
                      aria-expanded={gearOpen}
                      title="Guides, snapping and safe zones"
                      className={`tool-btn px-2.5 py-1.5 rounded-md text-sm ${guidesOn ? '!text-[var(--color-primary-green)]' : ''}`}
                    >
                      View <span className="text-[9px]" aria-hidden>▾</span>
                    </button>
                    {gearOpen && (
                      <div className="absolute left-0 mt-1.5 w-56 rounded-xl bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-glass-border)] z-40 p-2 text-sm">
                        <label className="flex items-center gap-2 px-2 py-1.5 font-medium cursor-pointer">
                          <input type="checkbox" checked={guidesOn} onChange={(e) => setGuidesOn(e.target.checked)} />
                          <span>Guides &amp; snapping</span>
                        </label>
                        <div className={`mt-1 ml-3 border-t border-[var(--color-glass-border)] pt-1 ${guidesOn ? '' : 'opacity-40 pointer-events-none'}`}>
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
                          <div className="mt-1 pt-1 border-t border-[var(--color-glass-border)] text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] px-2 pb-0.5">
                            Timeline snapping
                          </div>
                          {TIME_GUIDE_TOGGLES.map((g) => (
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
                        <div className="mt-1 pt-1 border-t border-[var(--color-glass-border)]">
                          <label className="flex items-center gap-2 px-2 py-1 hover:bg-[var(--color-glass-hover)] rounded-md cursor-pointer">
                            <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} />
                            <span>Safe zones</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Export sits at the far right and BECOMES the download once the
                      file is ready — no second "Save MP4" button to hunt for. */}
                  <div className="ml-auto flex items-center gap-1.5">
                    {downloadUrl ? (
                      <a
                        href={downloadUrl}
                        download={downloadName}
                        className="px-3.5 py-1.5 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold text-sm"
                      >
                        ↓ Save {downloadName.endsWith('.mp4') ? 'MP4' : 'WebM'}
                      </a>
                    ) : (
                      <button
                        onClick={doExport}
                        disabled={!mediaKind || busy}
                        className="px-3.5 py-1.5 rounded-md bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] text-black font-semibold disabled:opacity-40 text-sm"
                      >
                        {busy ? 'Working…' : 'Export MP4'}
                      </button>
                    )}
                    {downloadUrl && (
                      <button onClick={doExport} disabled={busy} title="Export again" aria-label="Export again" className={TOOL_BTN}>
                        ⟳
                      </button>
                    )}
                  </div>

                  {busy && (
                    <div className="w-full h-1 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] transition-[width] duration-150"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>

                <div
                  className="relative mx-auto"
                  // The preview is capped by HEIGHT, not width: a 9:16 project at
                  // 420px wide is 747px tall, which pushed the clip strip and the
                  // timeline off-screen. Deriving the width from the output aspect
                  // keeps preview + strip + timeline together in one viewport.
                  style={{ maxWidth: `min(420px, calc(${(out.w / Math.max(1, out.h)).toFixed(4)} * ${previewMaxVh}))` }}
                  onDragOver={onDragOverFiles}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDropFiles}
                >
                  {dragOver && (
                    <div className="pointer-events-none absolute inset-0 z-30 rounded-lg border-2 border-dashed border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.12)]" />
                  )}
                  <canvas
                    ref={attachCanvas}
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
                      <CropEditor
                        el={selectedLayer.el}
                        media={stickerMedia.current.get(selectedLayer.el.srcId)}
                        onChange={(patch) => updateStickerEl(selectedLayer.id, patch)}
                      />
                    )}

                  {/* clip crop editor (double-click) — replaces the clip's widget */}
                  {cropClipId && mediaKind && selectedClip && selectedClip.id === cropClipId && selClipPlacement && (
                    <CropEditor
                      el={{ ...selClipPlacement.transform, crop: selClipPlacement.crop }}
                      media={clipMedia.current.get(selectedClip.srcId)}
                      onChange={(patch) => onClipCrop(selectedClip, patch)}
                    />
                  )}

                  {/* transform widget for the selected CLIP — the same shared widget
                      every overlay layer uses, so a clip drags / resizes / rotates
                      and guide-locks identically. Aspect-locked like a sticker, so
                      the box always frames exactly what is drawn inside it. */}
                  {!editingZoom &&
                    !isGroup &&
                    mediaKind &&
                    srcDims.w > 0 &&
                    !isPlaceable(selectedLayer) &&
                    selectedClip &&
                    selClipPlacement &&
                    cropClipId !== selectedClip.id &&
                    (() => {
                      const clip = selectedClip;
                      const t = selClipPlacement.transform;
                      return (
                        <TransformBox
                          transform={t}
                          resize="locked"
                          lockedAspectPx={(t.w * out.w) / Math.max(1e-4, t.h * out.h)}
                          out={out}
                          settings={effectiveGuides}
                          others={otherBoxes}
                          color="#74b9ff"
                          onChange={(nt) => onClipTransform(clip, nt)}
                          onGuides={setGuideLines}
                        />
                      );
                    })()}

                  {/* unified transform widget for the single selected placeable layer.
                      Suppressed while it is hidden (nothing on screen to line up
                      against) or locked (the widget's whole job is to move it). */}
                  {!editingZoom &&
                    !isGroup &&
                    mediaKind &&
                    srcDims.w > 0 &&
                    isPlaceable(selectedLayer) &&
                    !selectedLayer.hidden &&
                    !selectedLayer.locked &&
                    selBox &&
                    !(selectedLayer.kind === 'sticker' && selectedLayer.id === croppingId) &&
                    !(selectedLayer.kind === 'sketch' && selectedLayer.el.strokes.length === 0) &&
                    (() => {
                      const sel: PlaceableLayer = selectedLayer;
                      const box = selBox;
                      const t: Transform = { ...box, rotation: sel.el.rotation };
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
                  {mediaKind && showSafeZones && ratio === '9:16' && !editingZoom && (
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

                  {!mediaKind && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                      {dragOver ? 'Drop to upload' : 'Upload a file first'}
                    </div>
                  )}
                </div>

                {editingZoom && (
                  <p className="text-[11px] text-[var(--color-primary-green)] mt-2 text-center">
                    Editing zoom rectangle — showing the full original frame. Drag the box; it snaps to centre / output ratio.
                  </p>
                )}

                {clips.length > 0 && (
                  <div className="mt-3 mb-1">
                    <div className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1">Clips · drag a file onto the preview to add another</div>
                    <ClipStrip
                      clips={clips}
                      selectedClipId={selectedClipId}
                      onSelect={selectClip}
                      onReorder={reorderClip}
                      onRemove={removeClip}
                      onDuplicate={duplicateClip}
                      onTrim={trimClip}
                      onAddClip={addClipClick}
                      onAddBlank={addBlankClip}
                      onAddFromLibrary={() => setLibraryOpen('clip')}
                      zOrder={clipZOrder}
                      onMoveZ={moveClipZ}
                      selectedBoundary={selectedBoundary}
                      onSelectBoundary={setSelectedBoundary}
                      onTransitionDur={setTransitionDur}
                      onRandomizeTransitions={randomizeTransitions}
                    />
                  </div>
                )}

                {mediaKind && (
                  <ProjectTimeline
                    duration={timelineDuration}
                    layers={displayLayers}
                    currentSec={currentSec}
                    selectedLayerId={selectedLayerId}
                    selectedAttachmentId={selectedAttachmentId}
                    selectedZoomKfId={selectedZoomKfId}
                    selectedSpeedIdx={selectedSpeedIdx}
                    clipExtents={clipExtents}
                    clipEdges={clipEdges}
                    selectedClipId={selectedClipId}
                    getClipBlob={getClipBlob}
                    onSelectClip={selectClip}
                    onMoveClip={moveClipToOutput}
                    markers={markers}
                    selectedMarkerId={selectedMarkerId}
                    onSelectMarker={selectMarker}
                    onMoveMarker={moveMarker}
                    onRemoveMarker={removeMarker}
                    onAddMarkerAt={addMarkerAt}
                    guideSettings={effectiveGuides}
                    onScrub={onScrub}
                    onSelectLayer={selectLayer}
                    onEditCaption={updateCaptionEl}
                    onSelectAttachment={selectAttachment}
                    onEditAttachment={updateAttachment}
                    onEditBanner={updateBanner}
                    onSelectZoomKf={selectZoomKf}
                    onEditZoomKf={updateZoomKf}
                    onSelectSpeedPoint={selectSpeedPoint}
                    onAddSpeedPoint={addSpeedPoint}
                    onMoveSpeedPoint={moveSpeedPoint}
                    onRemoveSpeedPoint={removeSpeedPoint}
                    onEditSketch={updateSketchEl}
                    onEditHighlighter={updateHighlighterEl}
                    onEditDramatic={updateDramaticEl}
                    onEditSticker={updateStickerEl}
                    onEditMusic={updateMusicEl}
                  />
                )}

                {/* Transport, add, view and export now live in the sticky bar at
                    the top of this card — see above. */}
                <p className="text-xs text-[var(--color-text-secondary)] mt-2 font-mono">{status}</p>
              </div>
            </section>

            {/* ---- Controls ----
                 The rail scrolls on its own and sticks under the header, so the
                 preview never leaves the screen while you dig through properties. */}
            <aside
              className="space-y-4 lg:sticky lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
              style={{
                top: '60px',
                maxHeight: fullscreen ? 'calc(100dvh - 76px)' : 'calc(72dvh - 24px)',
              }}
            >
              {/* Layers list */}
              <Panel title="Layers" badge={layers.length > 0 ? `${layers.length}` : undefined}>
                {layers.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {mediaKind ? 'Nothing yet — use “+ Add” in the toolbar above the preview.' : 'Upload a photo or video to begin.'}
                  </p>
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
                                  : l.kind === 'music'
                                    ? '🎵'
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
                            : l.kind === 'music'
                              ? l.el.name || l.name
                              : l.name;
                      // Reordering is itself a positional edit, so a lock stops it too.
                      const canMove =
                        l.kind !== 'zoom' && l.kind !== 'timemachine' && l.kind !== 'music' && !l.locked;
                      return (
                        <div key={l.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border ${isSel ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'}`}>
                          <button
                            onClick={() => selectLayer(l.id)}
                            className={`flex items-center gap-2 text-left text-[13px] min-w-0 flex-1 ${l.hidden ? 'opacity-45' : ''}`}
                          >
                            <span aria-hidden>{icon}</span>
                            <span className={`truncate ${l.hidden ? 'line-through decoration-[var(--color-text-muted)]' : ''}`}>{label}</span>
                            {(l.kind === 'zoom' || l.kind === 'timemachine') && <span className="text-[10px] text-[var(--color-text-muted)]">base</span>}
                          </button>
                          {canMove && (
                            <>
                              <button onClick={() => moveLayer(l.id, 1)} title="Bring forward" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1">↑</button>
                              <button onClick={() => moveLayer(l.id, -1)} title="Send backward" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1">↓</button>
                            </>
                          )}
                          <button
                            onClick={() => toggleLayerFlag(l.id, 'hidden')}
                            title={l.hidden ? 'Show this layer' : 'Hide from the output (preview and export)'}
                            aria-label={l.hidden ? `Show ${label}` : `Hide ${label}`}
                            aria-pressed={!!l.hidden}
                            className={`px-1 text-[13px] leading-none ${l.hidden ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-primary-green)]'} hover:opacity-80`}
                          >
                            <span aria-hidden>{l.hidden ? '🚫' : '👁'}</span>
                          </button>
                          <button
                            onClick={() => toggleLayerFlag(l.id, 'locked')}
                            title={l.locked ? 'Unlock — allow moving, resizing, retiming and deleting' : 'Lock against moving, resizing, retiming and deleting'}
                            aria-label={l.locked ? `Unlock ${label}` : `Lock ${label}`}
                            aria-pressed={!!l.locked}
                            className={`px-1 text-[13px] leading-none ${l.locked ? 'text-[var(--color-primary-blue)]' : 'text-[var(--color-text-muted)]'} hover:opacity-80`}
                          >
                            <span aria-hidden>{l.locked ? '🔒' : '🔓'}</span>
                          </button>
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
                            : selectedLayer.kind === 'music'
                              ? 'Music track'
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
                      selectedAttachmentId={selectedAttachmentId}
                      onEdit={(patch) => updateCaptionEl(selectedLayer.id, patch)}
                      onAddAttachment={(type) => addAttachment(selectedLayer.id, type)}
                      onSelectAttachment={(attId) => selectAttachment(selectedLayer.id, attId)}
                      onEditAttachment={(attId, patch) => updateAttachment(selectedLayer.id, attId, patch)}
                      onRemoveAttachment={(attId) => removeAttachment(selectedLayer.id, attId)}
                      onRemove={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'banner' && (
                    <BannerPanel
                      layer={selectedLayer as BannerLayer}
                      duration={timelineDuration}
                      conflict={bannerConflict}
                      onEdit={(patch) => updateBanner(selectedLayer.id, patch)}
                      onEditStyle={(patch) => updateBannerStyle(selectedLayer.id, patch)}
                      onRemove={() => requestDelete(selectedLayer.id)}
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
                      onRemoveLayer={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'timemachine' && (
                    <TimeMachinePanel
                      layer={selectedLayer as TimeMachineLayer}
                      selectedIdx={selectedSpeedIdx}
                      onAddRegion={addSpeedRegion}
                      onSetPointSpeed={setSpeedPointSpeed}
                      onRemovePoint={(idx) => removeSpeedPoint(selectedLayer.id, idx)}
                      onClear={clearSpeedCurve}
                      onEditLayer={(patch) => updateTimeMachine(selectedLayer.id, patch)}
                      onRemoveLayer={() => requestDelete(selectedLayer.id)}
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
                      onRemove={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'highlighter' && (
                    <HighlighterPanel
                      layer={selectedLayer as HighlighterLayer}
                      duration={timelineDuration}
                      onEdit={(patch) => updateHighlighterEl(selectedLayer.id, patch)}
                      onRemove={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'dramatic' && (
                    <DramaticPanel
                      layer={selectedLayer as DramaticLayer}
                      duration={timelineDuration}
                      onEdit={(patch) => updateDramaticEl(selectedLayer.id, patch)}
                      onRemove={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'sticker' && (
                    <StickerPanel
                      layer={selectedLayer as StickerLayer}
                      duration={timelineDuration}
                      cropping={croppingId === selectedLayer.id}
                      onEdit={(patch) => updateStickerEl(selectedLayer.id, patch)}
                      onToggleCrop={() => setCroppingId((c) => (c === selectedLayer.id ? null : selectedLayer.id))}
                      onRemove={() => requestDelete(selectedLayer.id)}
                    />
                  )}
                  {selectedLayer.kind === 'music' && (
                    <MusicPanel
                      key={selectedLayer.id}
                      el={selectedLayer.el}
                      onEdit={(patch, discrete) => {
                        if (discrete) sealDiscrete();
                        updateMusicEl(selectedLayer.id, patch);
                      }}
                    />
                  )}
                </Panel>
              )}

              {/* Selected clip boundary: its transition type + duration */}
              {selectedBoundary !== null && selectedBoundary > 0 && selectedBoundary < clips.length && (
                <Panel title="Transition">
                  <TransitionPanel
                    key={selectedBoundary}
                    clips={clips}
                    index={selectedBoundary}
                    onEdit={setTransition}
                    onRandomizeAll={randomizeTransitions}
                  />
                </Panel>
              )}

              {/* Everything about the selected base clip in ONE panel. These were
                  three sibling panels ("Clip placement" / "Clip audio" / "Clip
                  colour"), so selecting a clip pushed the layer properties a
                  screenful down the rail. */}
              {selectedClip && (
                <Panel title="Clip" badge={selectedClip.name}>
                  <Section title="Placement">
                    <ClipPlacementPanel
                      key={selectedClip.id}
                      clip={selectedClip}
                      cropping={cropClipId === selectedClip.id}
                      placed={selectedClip.transform !== undefined || selectedClip.crop !== undefined}
                      cropped={hasUserCrop(selectedClip)}
                      blank={isBlank(selectedClip)}
                      pinned={clips.some((c) => c.baseStart !== undefined)}
                      start={clipStarts[clips.indexOf(selectedClip)] ?? 0}
                      length={clipLen(selectedClip)}
                      baseDuration={duration}
                      zIndex={clipZOrder.indexOf(selectedClip.id) + 1}
                      clipCount={clips.length}
                      onMove={(t) => moveClipTo(selectedClip.id, t)}
                      onMoveZ={(dir) => moveClipZ(selectedClip.id, dir)}
                      onReflow={reflowClips}
                      onToggleCrop={() => setCropClipId((c) => (c === selectedClip.id ? null : selectedClip.id))}
                      onUncrop={() => uncropClip(selectedClip)}
                      onReset={() => resetClipPlacement(selectedClip.id)}
                    />
                  </Section>

                  {/* A still's on-screen length is a property of THIS clip, so it
                      belongs here — it used to hide in the Output panel. */}
                  {selectedClip.kind === 'image' && (() => {
                    const target = selectedClip;
                    const len = clipLen(target);
                    // Slider for a quick coarse set; the number field types an exact,
                    // frame-precise length (e.g. 3.03s) without snapping to 0.5s steps.
                    const setLen = (v: number) => {
                      if (!Number.isFinite(v)) return;
                      const c = Math.max(MIN_CLIP_LEN, Math.min(IMAGE_CLIP_MAX, v));
                      setImageDuration(c);
                      trimClip(target.id, { out: c });
                    };
                    return (
                      <Section title="Length">
                        <Field label="Seconds on screen">
                          <div className="flex items-center gap-2">
                            <input type="range" min={0.5} max={20} step={0.1} value={Math.min(20, len)} onChange={(e) => setLen(Number(e.target.value))} className="flex-1 accent-[var(--color-primary-green)]" />
                            <NumberInput
                              min={MIN_CLIP_LEN}
                              max={IMAGE_CLIP_MAX}
                              step={0.01}
                              value={Number(len.toFixed(2))}
                              onChange={setLen}
                              className="w-20 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-glass-border)] text-sm text-right tabular-nums"
                            />
                            <span className="text-xs text-[var(--color-text-muted)]">s</span>
                          </div>
                        </Field>
                      </Section>
                    );
                  })()}

                  {selectedClip.kind === 'video' && (
                    <Section title="Audio">
                      <ClipPanel
                        key={selectedClip.id}
                        clip={selectedClip}
                        onEdit={(patch, discrete) => editClip(selectedClip.id, patch, discrete)}
                      />
                    </Section>
                  )}

                  <Section title="Colour">
                    <GradePanel
                      key={selectedClip.id}
                      grade={selectedClip.grade ?? NEUTRAL_GRADE}
                      onChange={(g, discrete) => editClip(selectedClip.id, { grade: g }, discrete)}
                    />
                  </Section>
                </Panel>
              )}

              {/* Timeline markers — an editing aid; nothing here is rendered. */}
              {mediaKind && (
                <Panel title="Markers" badge={markers.length > 0 ? `${markers.length}` : undefined} collapsible defaultOpen={markers.length > 0}>
                  <MarkerPanel
                    markers={markers}
                    duration={timelineDuration}
                    selectedId={selectedMarkerId}
                    onSelect={selectMarker}
                    onEdit={editMarker}
                    onRemove={removeMarker}
                    onAdd={addMarkerAtPlayhead}
                  />
                </Panel>
              )}

              {/* Set-and-forget project settings. Collapsed by default so they stop
                  competing for rail space with the thing you actually selected. */}
              <Panel title="Output" collapsible defaultOpen={!mediaKind}>
                <Field label="Aspect ratio">
                  <ChoiceGrid cols={2} value={ratio} options={RATIO_LABELS} onChange={(v) => { sealDiscrete(); setRatio(v); }} />
                </Field>
                <Field label="Fill mode (when input ratio ≠ output)">
                  <ChoiceGrid cols={3} value={fillMode} options={FILL_MODES.map((m) => ({ key: m, label: m === 'crop' ? 'Crop' : m === 'fit' ? 'Fit' : 'Blur' }))} onChange={(v) => { sealDiscrete(); setFillMode(v); }} />
                </Field>
                {mediaKind && (
                  <Section title="Colour grade (global)">
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      Over the whole output (every clip + overlay), on top of any per-clip grade.
                    </p>
                    <GradePanel
                      grade={globalGrade}
                      onChange={(g, discrete) => {
                        if (discrete) sealDiscrete();
                        setGlobalGrade(g);
                      }}
                    />
                  </Section>
                )}
              </Panel>

              <Panel title="Caption defaults" collapsible defaultOpen={false}>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Starting font-boil pool + even-sizing for <em>newly added</em> captions. Each caption keeps its own — change one in its panel without touching the rest.
                </p>
                <Field label="Default pool for new captions">
                  <div className="grid grid-cols-3 gap-1.5">
                    {FONT_POOLS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { sealDiscrete(); setBoilPool(p.id); }}
                        className={`px-1 py-2 rounded-md text-[11px] border ${boilPool === p.id ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={normalize} onChange={(e) => { sealDiscrete(); setNormalize(e.target.checked); }} />
                  Even sizing by default (normalize each font to a consistent height)
                </label>
              </Panel>

              <Panel title="Sound effects" collapsible defaultOpen={false} badge={sfxEnabled ? 'on' : 'off'}>
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={sfxEnabled} onChange={(e) => { sealDiscrete(); setSfxEnabled(e.target.checked); }} />
                  Enable (banner slash, caption riffle/keys, zoom whoosh, sketch pencil)
                </label>
                {sfxEnabled && (
                  <Slider label={`SFX volume — ${Math.round(sfxVolume * 100)}%`} min={0} max={1} step={0.05} value={sfxVolume} onChange={setSfxVolume} />
                )}
              </Panel>
            </aside>
          </div>
        </div>

        {/* find & replace across caption / typewriter text (Cmd/Ctrl+F) */}
        {findOpen && (
          <FindReplace
            captions={captionsForFind}
            onReveal={selectLayer}
            onReplaceOne={replaceOneCaption}
            onReplaceAll={replaceAllCaptions}
            onClose={() => setFindOpen(false)}
          />
        )}

        {/* asset-library browser (choose from library / upload new) */}
        {libraryOpen && (
          <LibraryBrowser
            title={LIBRARY_INTENT_TITLE[libraryOpen]}
            emptyHint={LIBRARY_INTENT_EMPTY[libraryOpen]}
            entries={library.filter((e) => LIBRARY_INTENT_MEDIA[libraryOpen].includes(e.media))}
            onClose={() => setLibraryOpen(null)}
            onUploadNew={() => libraryUploadNew(libraryOpen)}
            onPick={libraryPick}
            onRename={libraryRename}
            onDelete={libraryDelete}
          />
        )}

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
  );

  // Full-screen breaks out of the iPad frame + dock entirely (identical editor,
  // just more room). Otherwise the editor lives inside the landscape iPad frame.
  return fullscreen ? (
    <div className="fixed inset-0 z-[80] overflow-auto ios-wallpaper" role="group" aria-label="Camera (full screen)">
      {editorBody}
    </div>
  ) : (
    <IpadFrame orientation="landscape" ariaLabel="Camera">{editorBody}</IpadFrame>
  );
}
