import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAgent } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { createDemoCrm, createDemoStore, SAMPLE_IDS } from '../src/demo-crm.mjs';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const SAMPLE =
  "what's open on Acme, log that they want a security review, and create a follow-up for Friday";

function demoAgent() {
  const store = createDemoStore();
  const crm = createDemoCrm(store);
  const config = loadConfig({ LLM_PROVIDER: 'mock', CRM_PROVIDER: 'demo' });
  return { store, crm, config };
}

async function ask(text, record) {
  const { store, crm, config } = demoAgent();
  const events = [];
  const outcome = await runAgent({
    text,
    record,
    config,
    crm,
    now: NOW,
    onEvent: (event) => events.push(event),
  });
  return { store, outcome, events };
}

describe('offline agent', () => {
  it('looks up Acme, logs the note, and creates Friday follow-up', async () => {
    const { store, outcome, events } = await ask(SAMPLE);
    const tools = events.filter((event) => event.type === 'tool').map((event) => event.name);

    assert.deepEqual(tools, [
      'lookup_record',
      'list_open_items',
      'add_note',
      'create_task',
    ]);
    assert.match(outcome.reply, /Acme Robotics/);
    assert.match(outcome.reply, /Warehouse robotics expansion/);
    assert.match(outcome.reply, /48000 USD/);
    assert.match(outcome.reply, /Send security questionnaire/);
    assert.match(outcome.reply, /They want a security review/);
    assert.match(outcome.reply, /Friday, November 13/);
    assert.match(outcome.reply, /sample records/);
    assert.equal(outcome.llm.provider, 'mock');

    const note = store.notes.find((item) =>
      item.bodyV2.markdown.includes('security review'),
    );
    const noteTarget = store.noteTargets.find((target) => target.noteId === note.id);
    assert.equal(noteTarget.targetCompanyId, SAMPLE_IDS.acme);

    const task = store.tasks.find((item) => item.title === 'Follow up');
    assert.equal(task.dueAt, '2026-11-13T17:00:00.000Z');
    assert.equal(task.status, 'TODO');
    const taskTarget = store.taskTargets.find((target) => target.taskId === task.id);
    assert.equal(taskTarget.targetCompanyId, SAMPLE_IDS.acme);
  });

  it('does not write a note when the named record is missing', async () => {
    const { store, outcome, events } = await ask(
      'log that Initech wants a pilot on Initech',
    );
    const tools = events.filter((event) => event.type === 'tool');
    assert.deepEqual(
      tools.map((event) => event.name),
      ['lookup_record'],
    );
    assert.match(outcome.reply, /could not find a company or person matching Initech/i);
    assert.equal(
      store.notes.some((note) => note.bodyV2.markdown.toLowerCase().includes('initech')),
      false,
    );
  });

  it('uses the open record when the utterance does not name one', async () => {
    const { store, outcome } = await ask('log that she asked for a security review', {
      id: SAMPLE_IDS.priya,
      object: 'person',
      label: 'Priya Shah',
    });
    assert.match(outcome.reply, /Priya Shah/);
    assert.match(outcome.reply, /She asked for a security review/);
    const note = store.notes.find((item) =>
      item.bodyV2.markdown.includes('security review'),
    );
    const target = store.noteTargets.find((item) => item.noteId === note.id);
    assert.equal(target.targetPersonId, SAMPLE_IDS.priya);
  });

  it('prefers the named company over the record currently open', async () => {
    const { outcome, events } = await ask("what's open on Acme", {
      id: SAMPLE_IDS.northwind,
      object: 'company',
      label: 'Northwind Traders',
    });
    const list = events.find((event) => event.name === 'list_open_items');
    assert.equal(list.arguments.recordId, SAMPLE_IDS.acme);
    assert.match(outcome.reply, /Acme Robotics/);
    assert.doesNotMatch(outcome.reply, /Spring catalog/);
  });

  it('sees a follow-up created earlier when asked what is open', async () => {
    const { crm, config } = demoAgent();
    await runAgent({ text: SAMPLE, config, crm, now: NOW });
    const second = await runAgent({
      text: "what's open on Acme",
      config,
      crm,
      now: NOW,
    });
    assert.match(second.reply, /Follow up/);
    assert.match(second.reply, /Send security questionnaire/);
  });
});
