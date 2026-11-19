import { TOOL_DEFINITIONS } from './tools.mjs';

function parseArguments(value) {
  if (value == null || value === '') {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return { _unparsed: String(value) };
  }
}

export function toApiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }

    return { role: message.role, content: message.content };
  });
}

export function parseNvidiaMessage(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message) {
    throw new Error('NVIDIA response did not include a message.');
  }

  const toolCalls = (message.tool_calls ?? []).slice(0, 4).map((call, index) => ({
    id: call.id || `nvidia-${index}`,
    name: call.function?.name,
    arguments: parseArguments(call.function?.arguments),
  }));

  return {
    content: typeof message.content === 'string' ? message.content : null,
    toolCalls: toolCalls.length ? toolCalls : null,
  };
}

export function createNvidiaLlm({ config, fetchImpl = fetch }) {
  return {
    provider: 'nvidia',
    model: config.llm.model,
    async complete({ messages }) {
      const response = await fetchImpl(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.llm.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.llm.model,
          temperature: 0.2,
          max_tokens: 700,
          tool_choice: 'auto',
          tools: TOOL_DEFINITIONS,
          messages: toApiMessages(messages),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const detail = payload?.error?.message || payload?.detail || text.slice(0, 180);
        throw new Error(`NVIDIA chat failed (${response.status}): ${detail}`);
      }

      const turn = parseNvidiaMessage(payload);
      return {
        ...turn,
        provider: 'nvidia',
        model: config.llm.model,
      };
    },
  };
}
