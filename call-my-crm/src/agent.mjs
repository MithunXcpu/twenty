import { createLlm, systemPrompt } from './llm.mjs';
import { executeTool, summarizeTool, TOOL_DEFINITIONS } from './tools.mjs';

const MAX_STEPS = 6;

function parseRecord(record) {
  if (!record?.id || (record.object !== 'company' && record.object !== 'person')) {
    return null;
  }
  return {
    id: String(record.id),
    object: record.object,
    label: typeof record.label === 'string' ? record.label.slice(0, 120) : '',
  };
}

function priorHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
    )
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2000),
    }));
}

function fallbackSuffix(usedFallback, config) {
  if (usedFallback && config.llm.provider === 'nvidia') {
    return ' NVIDIA was unavailable, so the offline agent answered.';
  }
  return '';
}

export async function runAgent({
  text,
  record,
  history,
  config,
  crm,
  now,
  fetchImpl,
  onEvent,
}) {
  const pageRecord = parseRecord(record);
  const llm = createLlm({
    config,
    now,
    fallbackRecord: pageRecord,
    fetchImpl,
  });
  const messages = [
    { role: 'system', content: systemPrompt(pageRecord, crm.sample) },
    ...priorHistory(history),
    { role: 'user', content: text },
  ];
  const toolCalls = [];
  let usedFallback = false;
  let fallbackReason = '';

  await onEvent?.({ type: 'transcript', role: 'user', text });

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const turn = await llm.complete({ messages, tools: TOOL_DEFINITIONS });
    if (turn.fallback) {
      usedFallback = true;
      fallbackReason = turn.fallbackReason || fallbackReason;
    }

    if (turn.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: turn.content ?? '',
        toolCalls: turn.toolCalls,
      });

      for (const call of turn.toolCalls) {
        if (!call.name) {
          continue;
        }
        let result;
        try {
          result = await executeTool(call.name, call.arguments ?? {}, {
            crm,
            now,
            fallbackRecord: pageRecord,
          });
        } catch (error) {
          result = { error: error.message };
        }

        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          arguments: call.arguments ?? {},
          result,
          content: JSON.stringify(result),
        });

        const event = {
          type: 'tool',
          name: call.name,
          arguments: call.arguments ?? {},
          result,
          summary: summarizeTool(call.name, result),
        };
        toolCalls.push(event);
        await onEvent?.(event);
      }
      continue;
    }

    const reply = `${(turn.content || '').trim() || 'I could not produce a reply.'}${fallbackSuffix(usedFallback, config)}`;
    const replyEvent = {
      type: 'reply',
      text: reply,
      llm: {
        provider: usedFallback ? 'mock' : turn.provider,
        model: usedFallback ? 'offline-mock' : turn.model,
        fallback: usedFallback,
        fallbackReason,
      },
      crm: { provider: crm.mode, sample: Boolean(crm.sample) },
    };
    await onEvent?.(replyEvent);
    return { reply, toolCalls, llm: replyEvent.llm };
  }

  const reply = `I stopped after several tool calls. Check the transcript for what was updated.${fallbackSuffix(usedFallback, config)}`;
  const replyEvent = {
    type: 'reply',
    text: reply,
    llm: {
      provider: usedFallback ? 'mock' : 'nvidia',
      model: usedFallback ? 'offline-mock' : config.llm.model,
      fallback: usedFallback,
      fallbackReason,
    },
    crm: { provider: crm.mode, sample: Boolean(crm.sample) },
  };
  await onEvent?.(replyEvent);
  return { reply, toolCalls, llm: replyEvent.llm };
}
