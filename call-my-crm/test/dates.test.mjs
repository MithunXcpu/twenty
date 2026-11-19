import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSpokenDate, resolveDueAt } from '../src/dates.mjs';
import { extractNote, extractQuery } from '../src/utterance.mjs';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const SAMPLE =
  "what's open on Acme, log that they want a security review, and create a follow-up for Friday";

describe('dates and utterance parsing', () => {
  it('turns Friday into the upcoming Friday evening UTC', () => {
    assert.equal(resolveDueAt(SAMPLE, NOW), '2026-11-13T17:00:00.000Z');
    assert.equal(
      formatSpokenDate('2026-11-13T17:00:00.000Z'),
      'Friday, November 13',
    );
  });

  it('keeps an ISO timestamp and moves next Friday a week out when today is Friday', () => {
    assert.equal(
      resolveDueAt('2026-11-20T09:00:00.000Z', NOW),
      '2026-11-20T09:00:00.000Z',
    );
    const friday = new Date('2026-11-13T15:00:00.000Z');
    assert.equal(resolveDueAt('next Friday', friday), '2026-11-20T17:00:00.000Z');
  });

  it('pulls the company and the note out of one sentence', () => {
    assert.equal(extractQuery(SAMPLE), 'Acme');
    assert.equal(extractNote(SAMPLE), 'They want a security review');
    assert.equal(extractQuery('what is open about Priya Shah'), 'Priya Shah');
  });
});
