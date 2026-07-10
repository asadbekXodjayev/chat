// Shared upload/size limits — imported by BOTH backend (enforcement) and frontend (pre-check)
// so the ceiling is agreed in exactly one place.

/** Hard ceiling for any single file/attachment upload: 100 MB. */
export const MAX_UPLOAD_BYTES = 104_857_600;

/** Human-readable form of {@link MAX_UPLOAD_BYTES} for UI copy. */
export const MAX_UPLOAD_LABEL = '100 MB';

/** Format a byte count as a short human-readable size (e.g. "3.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val >= 10 || Number.isInteger(val) ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}
