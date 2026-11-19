const QUERY_STOP_WORDS = new Set([
  'and',
  'log',
  'create',
  'with',
  'to',
  'for',
  'that',
  'they',
  'them',
]);

function cleanSentence(value) {
  const trimmed = value.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function extractQuery(text) {
  const match = text.match(/\b(?:on|about)\s+(.+?)(?=,|\band\b|$)/i);
  if (!match) {
    return null;
  }

  const words = match[1].trim().split(/\s+/).slice(0, 4);
  const kept = [];

  for (const word of words) {
    const bare = word.replace(/[^A-Za-z0-9.'-]/g, '');
    if (!bare || QUERY_STOP_WORDS.has(bare.toLowerCase())) {
      break;
    }
    kept.push(bare);
  }

  return kept.length ? kept.join(' ') : null;
}

export function extractNote(text) {
  const patterns = [
    /\blog(?: a note)? that\s+(.+?)(?=,?\s+and\b|$)/i,
    /\bnote that\s+(.+?)(?=,?\s+and\b|$)/i,
    /\badd a note(?::| that)?\s+(.+?)(?=,?\s+and\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanSentence(match[1]);
    }
  }

  return null;
}

export function wantsOpen(text) {
  return (
    /\b(pipeline|opportunit|going on)\b/i.test(text) ||
    /\bopen\b/i.test(text) ||
    /what(?:'s| is) open/i.test(text)
  );
}

export function wantsNote(text) {
  return /\b(log|note)\b/i.test(text);
}

export function wantsTask(text) {
  return /\b(follow-?up|task|remind|to-?do)\b/i.test(text);
}

export function taskTitle(text) {
  const specific = text.match(/\b(?:task|remind me) to\s+(.+?)(?=,|\band\b|$)/i);
  if (specific?.[1]) {
    return cleanSentence(specific[1]);
  }
  return 'Follow up';
}
