// ===== Shared option lists for the editor's project-settings controls =====

import type { FillMode, RatioKey } from '../types';

export const RATIO_LABELS: { key: RatioKey; label: string; hint: string }[] = [
  { key: '9:16', label: '9:16', hint: 'Shorts / Reels' },
  { key: '1:1', label: '1:1', hint: 'Square' },
  { key: '4:5', label: '4:5', hint: 'Portrait' },
  { key: 'original', label: 'Original', hint: 'No convert' },
];

export const FILL_MODES: FillMode[] = ['crop', 'fit', 'blur'];
