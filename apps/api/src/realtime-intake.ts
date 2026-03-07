import type { TimeWindow } from '@dispatchos/shared';

export interface RequestedSchedule {
  slotStart: string;
  slotEnd: string;
  label: string;
}

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function extractClock(text: string): { hours: number; minutes: number } | null {
  const twelveHour = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (twelveHour) {
    const rawHours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2] ?? '0');
    if (!Number.isFinite(rawHours) || rawHours < 1 || rawHours > 12 || minutes > 59) return null;
    let hours = rawHours % 12;
    if (twelveHour[3]?.toLowerCase() === 'pm') hours += 12;
    return { hours, minutes };
  }

  const twentyFourHour = text.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (!twentyFourHour) return null;

  return {
    hours: Number(twentyFourHour[1]),
    minutes: Number(twentyFourHour[2]),
  };
}

function exactDateFromMonthDay(text: string, now: Date): Date | null {
  const match = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
  );
  if (!match) return null;

  const [, monthText, dayText, yearText] = match;
  if (!monthText || !dayText) return null;

  const monthIndex = MONTH_INDEX[monthText.toLowerCase()];
  if (monthIndex === undefined) return null;
  const day = Number(dayText);
  const year = yearText ? Number(yearText) : now.getFullYear();
  const date = new Date(now);
  date.setFullYear(year, monthIndex, day);
  date.setHours(0, 0, 0, 0);

  if (!yearText && date.getTime() < now.getTime()) {
    date.setFullYear(date.getFullYear() + 1);
  }

  return date;
}

function formatTimeLabel(date: Date): string {
  const hours24 = date.getHours();
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes} ${period}`;
}

export function isBusinessQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  return [
    /company(?:'s)? name/,
    /\bwhat services\b/,
    /\bwhat do you provide\b/,
    /\bopening hours\b/,
    /\bwhen are you open\b/,
    /\bhow much\b/,
    /\bprice\b/,
    /\bcost\b/,
    /\bwhere are you located\b/,
    /\bservice area\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function shouldCaptureIssueText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 8) return false;
  if (/^(hello|hi|bonjour|bonsoir|hey)\b/i.test(normalized)) return false;
  if (isBusinessQuestion(normalized)) return false;
  if (/^\+?[0-9][0-9\s()-]{7,}$/.test(normalized)) return false;
  return true;
}

export function inferTimeWindowFromText(text: string): TimeWindow | undefined {
  const normalized = text.toLowerCase();
  if (normalized.includes('morning') || normalized.includes('matin')) return 'morning';
  if (normalized.includes('afternoon') || normalized.includes('apres-midi')) return 'afternoon';
  if (normalized.includes('evening') || normalized.includes('soir')) return 'evening';

  const clock = extractClock(normalized);
  if (!clock) return undefined;
  if (clock.hours < 12) return 'morning';
  if (clock.hours < 17) return 'afternoon';
  return 'evening';
}

export function extractRequestedSchedule(
  text: string,
  args: { now?: Date; durationMinutes?: number } = {},
): RequestedSchedule | null {
  const now = args.now ?? new Date();
  const durationMinutes = args.durationMinutes ?? 60;
  const normalized = text.toLowerCase();
  const clock = extractClock(normalized);
  if (!clock) return null;

  let date: Date | null = null;
  if (/\btomorrow\b|\bdemain\b/.test(normalized)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  } else if (/\btoday\b|\baujourd'hui\b/.test(normalized)) {
    date = new Date(now);
  } else {
    date = exactDateFromMonthDay(text, now);
  }
  if (!date) return null;

  date.setHours(clock.hours, clock.minutes, 0, 0);
  const end = new Date(date.getTime() + durationMinutes * 60 * 1000);
  const dayLabel = /\btomorrow\b|\bdemain\b/.test(normalized)
    ? 'tomorrow'
    : /\btoday\b|\baujourd'hui\b/.test(normalized)
      ? 'today'
      : date.toLocaleDateString('en-CH', { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    slotStart: date.toISOString(),
    slotEnd: end.toISOString(),
    label: `${dayLabel} at ${formatTimeLabel(date)}`,
  };
}
