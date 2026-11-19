import { createNvidiaLlm } from './nvidia-llm.mjs';
import { createOfflineLlm } from './offline-llm.mjs';

export function createLlm({ config, now, fallbackRecord, fetchImpl }) {
  const offline = createOfflineLlm({ now, fallbackRecord });

  if (config.llm.provider !== 'nvidia') {
    return offline;
  }

  if (!config.llm.apiKey) {
    return {
      provider: 'mock',
      model: 'offline-mock',
      async complete(input) {
        const turn = await offline.complete(input);
        return {
          ...turn,
          fallback: true,
          fallbackReason: 'NVIDIA_API_KEY is not set.',
        };
      },
    };
  }

  const nvidia = createNvidiaLlm({ config, fetchImpl });

  return {
    provider: 'nvidia',
    model: config.llm.model,
    async complete(input) {
      try {
        return await nvidia.complete(input);
      } catch (error) {
        const turn = await offline.complete(input);
        return {
          ...turn,
          fallback: true,
          fallbackReason: error.message,
        };
      }
    },
  };
}

export function systemPrompt(record, sample) {
  const recordLine = record?.id
    ? `Current record: ${record.label || record.object} (${record.object} ${record.id}). Use it when the user does not name a different company or person.`
    : 'No record is open. Ask which company or person they mean if the request needs one.';
  const dataLine = sample
    ? 'The workspace is sample demo data, not live customers. Say that when you report results.'
    : 'The workspace is the connected Twenty API. Report only what the tools return.';

  return [
    'You are Call My CRM, a voice agent for a Twenty workspace.',
    'Reply in two to four short sentences that can be read aloud.',
    'Use the tools for every lookup, note, and task. Never invent opportunities, tasks, notes, or amounts.',
    'If a tool returns an error or no record, say so and do not claim anything was saved.',
    'When the user asks what is open, call list_open_items.',
    'When they ask to log or note something, call add_note.',
    'When they ask for a follow-up or task, call create_task. Pass dueAt as an ISO-8601 timestamp when they name a day.',
    recordLine,
    dataLine,
  ].join(' ');
}
