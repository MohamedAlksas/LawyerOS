import { addCairoDays, getCairoTodayDateString } from '@/lib/cairo-date';
export { getCairoYear } from '@/modules/matters/file-code-allocator';

/**
 * Formats a YYYY-MM-DD calendar date offset from today (or `base`) anchored to Africa/Cairo.
 */
export function formatCairoOffsetYmd(daysFromNow: number, base: Date = new Date()): string {
  const todayCairo = getCairoTodayDateString(base);
  return addCairoDays(todayCairo, daysFromNow);
}
