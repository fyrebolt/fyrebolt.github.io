// ===== Naming and sizing helpers =====
//
// Small, pure, and shared between the queue and the download links.

/** `holiday.clip.MOV` -> `holiday.clip.gif`. A name with no extension keeps it. */
export function gifName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem || 'converted'}.gif`;
}

/**
 * A name safe to hand ffmpeg.wasm's in-memory filesystem. The original name
 * can carry quotes, slashes and spaces, all of which either break the argv or
 * escape the working directory; the extension is worth keeping because it
 * helps ffmpeg pick a demuxer for containers it can't sniff confidently.
 */
export function scratchName(fileName: string, id: number): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `in-${id}.${ext}` : `in-${id}`;
}

/** Human file size — GIFs get big, and the number is the point of the readout. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Where a file's overall 0..1 progress sits given which pass is running.
 * The palette pass reads every frame but writes one small image, so it is
 * consistently the quicker of the two — give it the first third of the bar.
 */
export const PALETTE_SHARE = 0.34;
export function overallProgress(pass: 'palette' | 'encode', passProgress: number): number {
  const p = Math.max(0, Math.min(1, passProgress));
  return pass === 'palette' ? p * PALETTE_SHARE : PALETTE_SHARE + p * (1 - PALETTE_SHARE);
}
