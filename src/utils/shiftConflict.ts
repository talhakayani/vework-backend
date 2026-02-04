/**
 * Check if two shifts overlap (same date, overlapping times).
 * Used to prevent employees from accepting conflicting shifts.
 */
export function shiftsOverlap(
  date1: Date,
  startTime1: string,
  endTime1: string,
  date2: Date,
  startTime2: string,
  endTime2: string
): boolean {
  const d1 = new Date(date1).toDateString();
  const d2 = new Date(date2).toDateString();
  if (d1 !== d2) return false;

  const [h1s, m1s] = startTime1.split(':').map(Number);
  const [h1e, m1e] = endTime1.split(':').map(Number);
  const [h2s, m2s] = startTime2.split(':').map(Number);
  const [h2e, m2e] = endTime2.split(':').map(Number);

  const start1 = h1s * 60 + m1s;
  const end1 = h1e * 60 + m1e;
  const start2 = h2s * 60 + m2s;
  const end2 = h2e * 60 + m2e;

  return start1 < end2 && end1 > start2;
}
