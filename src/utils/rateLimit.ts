import RateLimit from '../models/RateLimit';

const MAX_PER_DAY = 3;

/** End of current day UTC (start of next day 00:00:00 UTC) */
function getEndOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

/**
 * Check and consume one attempt for the key. Resets count at start of new day (UTC).
 * Returns { allowed, retriesLeft }.
 */
export async function checkRateLimit(key: string): Promise<{ allowed: boolean; retriesLeft: number }> {
  const now = new Date();
  const resetAt = getEndOfTodayUTC();

  let doc = await RateLimit.findOne({ key });

  if (doc) {
    if (now >= doc.resetAt) {
      doc.count = 0;
      doc.resetAt = getEndOfTodayUTC();
    }
    if (doc.count >= MAX_PER_DAY) {
      return { allowed: false, retriesLeft: 0 };
    }
    doc.count += 1;
  } else {
    doc = await RateLimit.create({ key, count: 1, resetAt });
  }
  await doc.save();

  const retriesLeft = MAX_PER_DAY - doc.count;
  return { allowed: true, retriesLeft };
}

/** Get current retries left without consuming (for display). */
export async function getRetriesLeft(key: string): Promise<number> {
  const now = new Date();
  const doc = await RateLimit.findOne({ key });
  if (!doc) return MAX_PER_DAY;
  if (now >= doc.resetAt) return MAX_PER_DAY;
  return Math.max(0, MAX_PER_DAY - doc.count);
}
