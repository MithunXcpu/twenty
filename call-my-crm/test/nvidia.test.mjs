import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAgent } from '../src/agent.mjs';
import { loadConfig } from '../src/config.mjs';
import { createDemoCrm, createDemoStore } from '../src/demo-crm.mjs';

const NOW = new Date('2026-11-11T15:00:00.000Z');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('NVIDIA chat tool calls', () => {
  it('sends OpenAI-style tool calls and feeds the tool result back', async () => {
    const bodies = [];
    const fetchImpl = async (url, init) => {
      bodies.push({ url: String(url), init, body: JSON.parse(init.body) });
      if (bodies.length === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'lookup_record',
                      arguments: '{"query":"Acme"}',
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: 'Acme Robotics is the sample company on this call.',
            },
          },
        ],
      });
    };

    const store = createDemoStore();
    const outcome = await runAgent({
      text: 'who is Acme',
      config: loadConfig({
        LLM_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'test-key',
        NVIDIA_MODEL: 'meta/llama-3.3-70b-instruct',
        CRM_PROVIDER: 'demo',
      }),
      crm: createDemoCrm(store),
      now: NOW,
      fetchImpl,
    });

    assert.equal(bodies.length, 2);
    assert.equal(
      bodies[0].url,
      'https://integrate.api.nvidia.com/v1/chat/completions',
    );
    assert.equal(bodies[0].init.headers.authorization, 'Bearer test-key');
    assert.equal(bodies[0].body.model, 'meta/llama-3.3-70b-instruct');
    assert.equal(bodies[0].body.tools.length, 4);
    const toolMessage = bodies[1].body.messages.find((message) => message.role === 'tool');
    assert.equal(toolMessage.tool_call_id, 'call_1');
    assert.match(toolMessage.content, /Acme Robotics/);
    assert.equal(
      outcome.reply,
      'Acme Robotics is the sample company on this call.',
    );
    assert.equal(outcome.llm.fallback, false);
  });

  it('falls back to the offline agent when NVIDIA fails', async () => {
    const store = createDemoStore();
    const crm = createDemoCrm(store);
    const outcome = await runAgent({
      text: "what's open on Acme, log that they want a security review, and create a follow-up for Friday",
      config: loadConfig({
        LLM_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'test-key',
        CRM_PROVIDER: 'demo',
      }),
      crm,
      now: NOW,
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    assert.equal(outcome.llm.fallback, true);
    assert.match(outcome.reply, /offline agent/);
    assert.match(outcome.reply, /security review/);
    assert.equal(
      store.tasks.some((task) => task.title === 'Follow up'),
      true,
    );
  });
});
