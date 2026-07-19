// ===== Video Editor tool registry =====
//
// To add a new editing tool: create its component under src/video/tools/, then
// add one entry here. The vertical menu, hash routing (/video/#<id>), and the
// tool heading are all driven by this list — nothing else needs to change.

import type { ComponentType } from 'react';
import EntranceBannerTool from './EntranceBannerTool';
import CaptionsTool from './CaptionsTool';
import ZoomTool from './ZoomTool';
import SketchTool from './SketchTool';
import HighlighterTool from './HighlighterTool';
import StaticZoomTool from './StaticZoomTool';
import DramaticWordingTool from './DramaticWordingTool';

export interface VideoTool {
  /** Stable id; also the URL hash (/video/#<id>). Keep it kebab-case. */
  id: string;
  /** Menu label. */
  label: string;
  /** Emoji shown in the menu and header. */
  icon: string;
  /** One-line description shown under the tool heading. */
  blurb: string;
  component: ComponentType;
}

export const TOOLS: VideoTool[] = [
  {
    id: 'entrance-banner',
    label: 'Entrance Banner',
    icon: '⚔️',
    blurb:
      'Overlay a Smash-style character-intro banner on your footage and format it for vertical short-form. Upload, place the freeze point, and export an MP4.',
    component: EntranceBannerTool,
  },
  {
    id: 'captions',
    label: 'Captions',
    icon: '💬',
    blurb:
      'Add any number of animated text captions with a "font boil" reveal. Drag each on the canvas, time it on the multi-track timeline, and export an MP4.',
    component: CaptionsTool,
  },
  {
    id: 'zoom',
    label: 'Zoom',
    icon: '🔍',
    blurb:
      'Add sequential zoom keyframes: drag a crop rectangle on the full frame, set each transition, and the video animates between them. Non-destructive — reframe from the original anytime.',
    component: ZoomTool,
  },
  {
    id: 'sketch',
    label: 'Sketch',
    icon: '✏️',
    blurb:
      'Draw freehand on a mini pad, then project it as a resizable, replayable overlay that animates on like someone drawing live on the footage. Add any number, each timed on its own track.',
    component: SketchTool,
  },
  {
    id: 'highlighter',
    label: 'Highlighter',
    icon: '🖍️',
    blurb:
      'Sweep a resizable highlight box over any part of the footage. Place and size it freely, then tune its color, transparency, duration and sweep-in / sweep-out. Add any number, each timed on its own track.',
    component: HighlighterTool,
  },
  {
    id: 'static-zoom',
    label: 'Static Zoom',
    icon: '🖼️',
    blurb:
      'Turn a photo into a moving clip: set a total length, then zoom into a part of the image (or pull back out). Drag the crop rectangle to frame it and the timeline to set when it happens — holds before and after fill the rest.',
    component: StaticZoomTool,
  },
  {
    id: 'dramatic-wording',
    label: 'Dramatic Wording',
    icon: '🔠',
    blurb:
      'Big plain uppercase words over your footage. Keep the word translucent, or invert it — dim everything except the word (up to a full black-out) to spotlight it. Drag to place, time each on the bar, fade in/out. Add any number; no two overlap.',
    component: DramaticWordingTool,
  },
];

export const DEFAULT_TOOL_ID = TOOLS[0].id;

export function toolById(id: string | null | undefined): VideoTool {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}
