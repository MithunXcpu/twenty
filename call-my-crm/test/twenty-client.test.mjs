import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

import { createTwentyClient } from '../src/twenty-client.mjs';

const ACME_ID = '11111111-1111-4111-8111-111111111111';
const PRIYA_ID = '33333333-3333-4333-8333-333333333333';
const API_KEY = 'twenty-test-token';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

describe('Twenty REST client', () => {
  it('maps lookup, notes, and tasks onto Twenty responses', async () => {
    const seen = [];
    const company = {
      id: ACME_ID,
      name: 'Acme Robotics',
      domainName: { primaryLinkUrl: 'acme.example' },
    };
    const person = {
      id: PRIYA_ID,
      name: { firstName: 'Priya', lastName: 'Shah' },
      jobTitle: 'VP Engineering',
      emails: { primaryEmail: 'priya.shah@acme.example' },
      companyId: ACME_ID,
    };
    const fake = await listen(async (req, res) => {
      const url = new URL(req.url, 'http://twenty.test');
      const body = await readJson(req);
      seen.push({
        method: req.method,
        path: url.pathname,
        filter: url.searchParams.get('filter'),
        authorization: req.headers.authorization,
        body,
      });

      if (req.headers.authorization !== `Bearer ${API_KEY}`) {
        res.writeHead(401).end(JSON.stringify({ error: 'bad token' }));
        return;
      }

      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'GET' && url.pathname === '/rest/companies') {
        const filter = url.searchParams.get('filter') ?? '';
        const byName = filter.startsWith('name[ilike]') && filter.includes('%Acme%');
        const byDomain =
          filter.includes('primaryLinkUrl') && filter.includes('acme.example');
        send(200, { data: { companies: byName || byDomain ? [company] : [] } });
        return;
      }
      if (req.method === 'GET' && url.pathname === `/rest/companies/${ACME_ID}`) {
        send(200, { data: { company } });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/rest/people') {
        const filter = url.searchParams.get('filter') ?? '';
        send(200, {
          data: { people: filter.includes(ACME_ID) ? [person] : [] },
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/rest/opportunities') {
        send(200, {
          data: {
            opportunities: [
              {
                id: 'opp-open',
                name: 'Warehouse robotics expansion',
                stage: 'PROPOSAL',
                amount: { amountMicros: 48_000_000_000, currencyCode: 'USD' },
                closeDate: '2026-12-15T00:00:00.000Z',
                companyId: ACME_ID,
              },
              {
                id: 'opp-won',
                name: 'Starter kit',
                stage: 'CUSTOMER',
                amount: { amountMicros: 5_000_000_000, currencyCode: 'USD' },
                companyId: ACME_ID,
              },
            ],
          },
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/rest/taskTargets') {
        send(200, {
          data: {
            taskTargets: [
              {
                id: 'tt-open',
                taskId: 'task-open',
                targetCompanyId: ACME_ID,
                task: {
                  id: 'task-open',
                  title: 'Send security questionnaire',
                  status: 'TODO',
                  dueAt: '2026-11-18T17:00:00.000Z',
                },
              },
              {
                id: 'tt-done',
                taskId: 'task-done',
                targetCompanyId: ACME_ID,
                task: {
                  id: 'task-done',
                  title: 'Intro call',
                  status: 'DONE',
                },
              },
            ],
          },
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rest/notes') {
        send(201, { data: { createNote: { id: 'note-1', title: body.title } } });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rest/noteTargets') {
        send(201, { data: { createNoteTarget: { id: 'note-target-1' } } });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rest/tasks') {
        send(201, {
          data: {
            createTask: {
              id: 'task-new',
              title: body.title,
              status: body.status,
              dueAt: body.dueAt,
            },
          },
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rest/taskTargets') {
        send(201, { data: { createTaskTarget: { id: 'task-target-1' } } });
        return;
      }

      send(404, { error: 'missing' });
    });

    try {
      const crm = createTwentyClient({
        baseUrl: fake.url,
        apiKey: API_KEY,
      });
      const found = await crm.lookup({ query: 'Acme' });
      assert.equal(found.match.label, 'Acme Robotics');
      assert.equal(found.match.people[0].label, 'Priya Shah');
      assert.equal(found.sample, false);

      const open = await crm.listOpenItems({
        recordId: ACME_ID,
        object: 'company',
      });
      assert.deepEqual(
        open.opportunities.map((item) => item.name),
        ['Warehouse robotics expansion'],
      );
      assert.equal(open.opportunities[0].amount.amount, 48000);
      assert.deepEqual(
        open.tasks.map((item) => item.title),
        ['Send security questionnaire'],
      );

      const note = await crm.addNote({
        recordId: ACME_ID,
        object: 'company',
        title: 'Call note',
        body: 'They want a security review',
      });
      assert.equal(note.id, 'note-1');

      const task = await crm.createTask({
        recordId: ACME_ID,
        object: 'company',
        title: 'Follow up',
        body: 'Follow up',
        dueAt: '2026-11-13T17:00:00.000Z',
      });
      assert.equal(task.dueAt, '2026-11-13T17:00:00.000Z');

      const byDomain = await crm.lookup({ query: 'acme.example' });
      assert.equal(byDomain.match.id, ACME_ID);

      const notePost = seen.find(
        (call) => call.method === 'POST' && call.path === '/rest/notes',
      );
      assert.deepEqual(notePost.body.bodyV2, {
        markdown: 'They want a security review',
        blocknote: null,
      });
      const noteLink = seen.find(
        (call) => call.method === 'POST' && call.path === '/rest/noteTargets',
      );
      assert.equal(noteLink.body.noteId, 'note-1');
      assert.equal(noteLink.body.targetCompanyId, ACME_ID);
      const taskPost = seen.find(
        (call) => call.method === 'POST' && call.path === '/rest/tasks',
      );
      assert.equal(taskPost.body.status, 'TODO');
      assert.equal(taskPost.body.dueAt, '2026-11-13T17:00:00.000Z');
      const taskLink = seen.find(
        (call) => call.method === 'POST' && call.path === '/rest/taskTargets',
      );
      assert.equal(taskLink.body.taskId, 'task-new');
      assert.equal(taskLink.body.targetCompanyId, ACME_ID);
      assert.equal(
        seen.every((call) => call.authorization === `Bearer ${API_KEY}`),
        true,
      );
    } finally {
      await fake.close();
    }
  });

  it('returns the Twenty error instead of throwing', async () => {
    const fake = await listen((req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'workspace unavailable' }));
    });
    try {
      const crm = createTwentyClient({
        baseUrl: `${fake.url}/rest`,
        apiKey: API_KEY,
      });
      const found = await crm.lookup({ query: 'Acme' });
      assert.match(found.error, /workspace unavailable/);
      assert.equal(found.error.includes(API_KEY), false);
    } finally {
      await fake.close();
    }
  });
});
