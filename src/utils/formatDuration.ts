/**
 * Format duration consistently across the app:
 * - < 1 min → seconds (e.g. "45s")
 * - < 1 hour → minutes (e.g. "30 min")
 * - >= 1 hour → "Xh Ym" or "Xh"
 */
export function formatDuration(hours: number): string {
  const totalSeconds = Math.round(Number(hours) * 3600);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)} min`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
