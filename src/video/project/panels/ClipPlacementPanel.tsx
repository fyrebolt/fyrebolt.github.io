// ===== Clip placement panel: where a clip sits, in space and in time =====
//
// The spatial work happens on-canvas (the shared TransformBox) exactly as it does
// for a sticker; this panel owns what a widget can't express: the clip's position
// on the base clock, its stacking order against other clips, the crop-mode toggle,
// and the two resets.
//
// It differs from StickerPanel in two ways that are specific to clips:
//   - an already-cropped clip can be un-cropped in one gesture (a second
//     double-click on the preview, or the button here), and
//   - a clip can be reset to the untouched full-frame default, which is what every
//     clip is until it is placed.

import { DangerButton, NumberField } from '../ui';
import { round2 } from '../constants';
import type { VideoClip } from '../clips';

interface Props {
  clip: VideoClip;
  /** Crop-adjust mode is live for this clip. */
  cropping: boolean;
  /** The clip carries an explicit transform or crop (i.e. it has been placed). */
  placed: boolean;
  /** The clip carries an active, non-full crop. */
  cropped: boolean;
  /** Any clip in the project has been pinned to an explicit base-clock position. */
  pinned: boolean;
  /** Where the clip currently starts on the base clock, and how long it runs. */
  start: number;
  length: number;
  /** Total base-clock span, for bounding the start field. */
  baseDuration: number;
  /** Paint order among clips: 1-based position from the bottom, and the count. */
  zIndex: number;
  clipCount: number;
  onMove: (baseStart: number) => void;
  onMoveZ: (dir: -1 | 1) => void;
  onReflow: () => void;
  onToggleCrop: () => void;
  onUncrop: () => void;
  onReset: () => void;
}

export default function ClipPlacementPanel({
  clip,
  cropping,
  placed,
  cropped,
  pinned,
  start,
  length,
  baseDuration,
  zIndex,
  clipCount,
  onMove,
  onMoveZ,
  onReflow,
  onToggleCrop,
  onUncrop,
  onReset,
}: Props) {
  // The span grows as a clip is pushed later, so the cap is just today's total.
  const maxStart = Math.max(length, baseDuration);

  return (
    <>
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">
        Drag on the preview to move; use the handles to resize &amp; rotate. Double-click the clip to crop
        {cropped ? ' — double-click it again to remove the crop.' : '.'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Starts at — ${round2(start)}s`}
          min={0}
          max={round2(maxStart)}
          step={0.1}
          value={round2(start)}
          onChange={onMove}
        />
        <div className="rounded-md border border-[var(--color-glass-border)] px-2.5 py-1.5">
          <div className="text-[10px] text-[var(--color-text-muted)]">Length</div>
          <div className="text-xs font-medium">{round2(length)}s</div>
        </div>
      </div>
      <div className="text-[10px] text-[var(--color-text-muted)] -mt-1">
        Clips may overlap in time — move one over another and both play at once, stacked by the order below. A shared
        edge between two untouched, full-frame clips is still a transition, not a stack.
      </div>

      {pinned && (
        <button
          onClick={onReflow}
          className="w-full px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-xs font-medium hover:bg-[var(--color-glass-hover)]"
        >
          Re-flow every clip end to end
        </button>
      )}
      {pinned && (
        <div className="text-[10px] text-[var(--color-text-muted)] -mt-1">
          Moved clips hold their own position, so reordering the strip no longer shifts them in time. This drops every
          position and lays the clips back to back.
        </div>
      )}

      {/* stacking order — the layers list's bring-forward / send-backward pattern */}
      <div className="flex items-center justify-between rounded-md border border-[var(--color-glass-border)] px-2.5 py-1.5">
        <div>
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Stacking order</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">
            {zIndex} of {clipCount} from the back — higher draws on top where clips overlap
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onMoveZ(1)}
            disabled={zIndex >= clipCount}
            title="Bring forward"
            className="px-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onClick={() => onMoveZ(-1)}
            disabled={zIndex <= 1}
            title="Send backward"
            className="px-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
          >
            ↓
          </button>
        </div>
      </div>

      <button
        onClick={onToggleCrop}
        className={`w-full mt-1 px-3 py-2 rounded-md border text-xs font-medium ${
          cropping
            ? 'border-[var(--color-primary-green)] bg-[rgba(139,233,199,0.12)] text-[var(--color-primary-green)]'
            : 'border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]'
        }`}
      >
        {cropping ? 'Done cropping' : `Crop ${clip.kind === 'image' ? 'image' : 'clip'}`}
      </button>
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Cropping sets which part of the source shows inside the frame — the frame keeps the crop's shape.
      </div>

      {cropped && (
        <button
          onClick={onUncrop}
          className="w-full px-3 py-2 rounded-md border border-[var(--color-glass-border)] text-xs font-medium hover:bg-[var(--color-glass-hover)]"
        >
          Remove crop (show the whole source)
        </button>
      )}

      {placed && (
        <DangerButton onClick={onReset} className="mt-1">
          Reset to full frame
        </DangerButton>
      )}
    </>
  );
}
