const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function atEveningUtc(date) {
  const next = new Date(date.getTime());
  next.setUTCHours(17, 0, 0, 0);
  return next;
}

export function resolveDueAt(input, now) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmedInput = input.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmedInput)) {
    const parsed = new Date(trimmedInput);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  const lower = trimmedInput.toLowerCase();
  const weekday = lower.match(
    /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );

  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    let delta = (target - now.getUTCDay() + 7) % 7;
    if (delta === 0 && lower.includes('next ')) {
      delta = 7;
    }
    const date = atEveningUtc(now);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString();
  }

  if (/\btomorrow\b/.test(lower)) {
    const date = atEveningUtc(now);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }

  if (/\bnext week\b/.test(lower)) {
    const date = atEveningUtc(now);
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString();
  }

  return null;
}

export function formatSpokenDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
