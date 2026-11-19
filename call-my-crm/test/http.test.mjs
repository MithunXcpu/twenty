import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../src/create-app.mjs';
import { loadConfig, publicConfig } from '../src/config.mjs';

const NOW = () => new Date('2026-11-11T15:00:00.000Z');
const SAMPLE =
  "what's open on Acme, log that they want a security review, and create a follow-up for Friday";

function start(env) {
  const config = loadConfig(env);
  const app = createApp({ config, now: NOW });
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once('listening', () => {
      const { port } = server.address();
      resolve({
        app,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

describe('config', () => {
  it('uses the offline agent and sample CRM when no keys are set', () => {
    const config = loadConfig({});
    assert.equal(config.llm.provider, 'mock');
    assert.equal(config.crm.provider, 'demo');
    assert.equal(config.stt.mode, 'browser');
    assert.equal(config.tts.mode, 'browser');
  });

  it('does not publish the NVIDIA key', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'nvidia',
      NVIDIA_API_KEY: 'super-secret-key',
      CRM_PROVIDER: 'demo',
    });
    const published = JSON.stringify(publicConfig(config));
    assert.equal(published.includes('super-secret-key'), false);
    assert.match(published, /meta\/llama-3.3-70b-instruct/);
  });
});

describe('http app', () => {
  it('serves the desk, runs the sample call, and accepts a Teams webhook', async () => {
    const running = await start({
      LLM_PROVIDER: 'mock',
      CRM_PROVIDER: 'demo',
      TEAMS_WEBHOOK_SECRET: 'teams-secret',
    });

    try {
      const page = await fetch(`${running.url}/`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /Call My CRM/);
      assert.match(html, /id="call-fab"/);

      const embed = await fetch(`${running.url}/embed.js`);
      assert.match(await embed.text(), /companies\|people/);

      const preview = await fetch(`${running.url}/record-preview.html`);
      assert.match(await preview.text(), /data-record-id="11111111-1111-4111-8111-111111111111"/);

      const records = await fetch(`${running.url}/api/records`);
      const recordPayload = await records.json();
      assert.equal(recordPayload.sample, true);
      assert.equal(
        recordPayload.records.some((record) => record.label === 'Acme Robotics'),
        true,
      );

      const denied = await fetch(`${running.url}/webhooks/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: SAMPLE }),
      });
      assert.equal(denied.status, 401);

      const agent = await fetch(`${running.url}/api/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: SAMPLE }),
      });
      assert.match(agent.headers.get('content-type'), /ndjson/);
      const events = (await agent.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        events.filter((event) => event.type === 'tool').map((event) => event.name),
        ['lookup_record', 'list_open_items', 'add_note', 'create_task'],
      );
      const reply = events.find((event) => event.type === 'reply');
      assert.match(reply.text, /security review/);

      const teams = await fetch(`${running.url}/webhooks/teams`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer teams-secret',
        },
        body: JSON.stringify({
          type: 'message',
          text: "what's open on Acme",
          from: { name: 'Teams' },
        }),
      });
      const teamsBody = await teams.json();
      assert.equal(teams.status, 200);
      assert.equal(teamsBody.type, 'message');
      assert.match(teamsBody.text, /Follow up/);
      assert.match(teamsBody.text, /Actions:/);
      assert.equal(
        teamsBody.toolCalls.some((call) => call.name === 'list_open_items'),
        true,
      );

      const stt = await fetch(`${running.url}/api/stt`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: Buffer.from('audio'),
      });
      assert.equal(stt.status, 409);
      assert.equal((await stt.json()).fallback, 'browser');

      const tts = await fetch(`${running.url}/api/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello from the sample call.' }),
      });
      assert.equal((await tts.json()).mode, 'browser');

      const contract = await fetch(`${running.url}/webhooks/teams`);
      assert.equal((await contract.json()).secretRequired, true);
    } finally {
      await running.close();
    }
  });
});
