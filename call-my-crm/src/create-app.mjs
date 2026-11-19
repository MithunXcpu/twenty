import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import http from 'node:http';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from './agent.mjs';
import { loadConfig, publicConfig } from './config.mjs';
import { createCrm } from './crm.mjs';
import { synthesizeSpeech, transcribeAudio } from './speech.mjs';

const MAX_JSON_BYTES = 100_000;
const MAX_AUDIO_BYTES = 8_000_000;

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/embed.js', 'embed.js'],
  ['/record-preview.html', 'record-preview.html'],
  ['/favicon.svg', 'favicon.svg'],
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, MAX_JSON_BYTES);
  if (!raw.length) {
    return {};
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be JSON.'), { statusCode: 400 });
  }
}

function authorized(req, secret) {
  if (!secret) {
    return true;
  }
  const header = req.headers['x-call-my-crm-secret'];
  const authorization = req.headers.authorization ?? '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : '';
  const provided = (typeof header === 'string' && header.trim()) || bearer;
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function teamsText(body) {
  if (typeof body.text === 'string' && body.text.trim()) {
    return body.text.trim();
  }
  if (typeof body.message?.text === 'string') {
    return body.message.text.trim();
  }
  return '';
}

function teamsRecord(body) {
  if (body.record?.id) {
    return body.record;
  }
  if (body.recordId) {
    return {
      id: body.recordId,
      object: body.object,
      label: body.label,
    };
  }
  return null;
}

function formatTeamsMessage(reply, toolCalls) {
  if (!toolCalls.length) {
    return reply;
  }
  const lines = [reply, '', 'Actions:'];
  for (const call of toolCalls) {
    lines.push(`- ${call.name}: ${call.summary}`);
  }
  return lines.join('\n');
}

async function serveStatic(res, pathname) {
  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) {
    return false;
  }
  const filePath = fileURLToPath(new URL(`../public/${fileName}`, import.meta.url));
  await access(filePath);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(fileName)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export function createApp({
  env = process.env,
  config = loadConfig(env),
  now = () => new Date(),
  fetchImpl,
  logger,
} = {}) {
  const crm = createCrm(config, { fetchImpl });

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const { pathname } = url;

    try {
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && (await serveStatic(res, pathname))) {
        return;
      }

      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'call-my-crm' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, publicConfig(config));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/records') {
        sendJson(res, 200, {
          sample: crm.sample,
          provider: crm.mode,
          records: crm.listRecords(),
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/webhooks/teams') {
        sendJson(res, 200, {
          endpoint: '/webhooks/teams',
          method: 'POST',
          secretRequired: Boolean(config.teamsSecret),
          description:
            'Post a Teams message, or a Power Automate HTTP body, to run the same CRM agent. This is not a Teams store app.',
          body: {
            text: "what's open on Acme, log that they want a security review, and create a follow-up for Friday",
            recordId: 'optional-twenty-record-id',
            object: 'company',
          },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/webhooks/teams') {
        if (!authorized(req, config.teamsSecret)) {
          sendJson(res, 401, { error: 'Unauthorized webhook.' });
          return;
        }
        const body = await readJson(req);
        const text = teamsText(body);
        if (!text) {
          sendJson(res, 400, { error: 'A text field is required.' });
          return;
        }
        const outcome = await runAgent({
          text: text.slice(0, 4000),
          record: teamsRecord(body),
          config,
          crm,
          now: now(),
          fetchImpl,
          onEvent(event) {
            if (event.type === 'tool') {
              logger?.(`[call-my-crm] teams tool ${event.name}`);
            }
          },
        });
        sendJson(res, 200, {
          type: 'message',
          text: formatTeamsMessage(outcome.reply, outcome.toolCalls),
          reply: outcome.reply,
          toolCalls: outcome.toolCalls.map((call) => ({
            name: call.name,
            arguments: call.arguments,
            summary: call.summary,
            result: call.result,
          })),
          llm: outcome.llm,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/agent') {
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) {
          sendJson(res, 400, { error: 'A text field is required.' });
          return;
        }

        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff',
        });

        await runAgent({
          text: text.slice(0, 4000),
          record: body.record,
          history: body.history,
          config,
          crm,
          now: now(),
          fetchImpl,
          onEvent(event) {
            if (event.type === 'tool') {
              logger?.(`[call-my-crm] tool ${event.name}`);
            }
            res.write(`${JSON.stringify(event)}\n`);
          },
        });
        res.end();
        return;
      }

      if (req.method === 'POST' && pathname === '/api/stt') {
        if (!config.stt.ready || config.stt.mode !== 'server') {
          sendJson(res, 409, {
            error: 'Server speech-to-text is not configured.',
            fallback: 'browser',
          });
          return;
        }
        const audio = await readBody(req, MAX_AUDIO_BYTES);
        if (!audio.length) {
          sendJson(res, 400, { error: 'Audio body is empty.' });
          return;
        }
        try {
          const result = await transcribeAudio({
            audio,
            contentType: req.headers['content-type'],
            stt: config.stt,
            fetchImpl,
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 502, { error: error.message, fallback: 'browser' });
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/tts') {
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) {
          sendJson(res, 400, { error: 'A text field is required.' });
          return;
        }
        try {
          const spoken = await synthesizeSpeech({
            text: text.slice(0, 2000),
            tts: config.tts,
            fetchImpl,
          });
          if (spoken.mode === 'browser') {
            sendJson(res, 200, spoken);
            return;
          }
          res.writeHead(200, {
            'content-type': spoken.contentType,
            'content-length': spoken.audio.length,
            'cache-control': 'no-store',
          });
          res.end(spoken.audio);
        } catch (error) {
          sendJson(res, 200, {
            mode: 'browser',
            text,
            fallback: true,
            error: error.message,
          });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : 'Server error',
      });
      if (!error.statusCode) {
        logger?.(`[call-my-crm] ${error.stack || error.message}`);
      }
    }
  }

  function listen(port = config.port, callback) {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });
    server.listen(port, '0.0.0.0', callback);
    return server;
  }

  return { handle, listen, config, crm };
}
