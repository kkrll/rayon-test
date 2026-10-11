// Timestamps are generated in UTC "wall clock" time, so format with UTC getters.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DAY_MS = 24 * 60 * 60 * 1000;

export function dayIndex(ts: number) {
  return Math.floor(ts / DAY_MS);
}

export function formatDay(ts: number) {
  const d = new Date(ts);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatMonth(ts: number) {
  const d = new Date(ts);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "14 h", "3 days" — label for a compressed idle gap. */
export function formatGap(ms: number) {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(ms / DAY_MS);
  return days === 1 ? '1 day' : `${days} days`;
}
