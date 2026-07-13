// ===== Video Editor tool registry =====
//
// To add a new editing tool: create its component under src/video/tools/, then
// add one entry here. The vertical menu, hash routing (/video/#<id>), and the
// tool heading are all driven by this list — nothing else needs to change.

import type { ComponentType } from 'react';
import EntranceBannerTool from './EntranceBannerTool';

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
];

export const DEFAULT_TOOL_ID = TOOLS[0].id;

export function toolById(id: string | null | undefined): VideoTool {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}
