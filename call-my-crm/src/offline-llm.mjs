import { formatSpokenDate, resolveDueAt } from './dates.mjs';
import { describeOpenItems } from './tools.mjs';
import {
  extractNote,
  extractQuery,
  taskTitle,
  wantsNote,
  wantsOpen,
  wantsTask,
} from './utterance.mjs';

function alreadyCalled(messages, name) {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.toolCalls?.some((call) => call.name === name),
  );
}

function resultOf(messages, name) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'tool' && message.name === name)?.result;
}

export function buildOfflineReply(messages) {
  const lookup = resultOf(messages, 'lookup_record');
  const open = resultOf(messages, 'list_open_items');
  const note = resultOf(messages, 'add_note');
  const task = resultOf(messages, 'create_task');
  const sentences = [];
  const sample = [lookup, open, note, task].some((result) => result?.sample);

  if (lookup?.error && !lookup.match) {
    sentences.push(lookup.error);
  } else if (lookup && !lookup.match) {
    const query = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant')
      ?.toolCalls?.find((call) => call.name === 'lookup_record')?.arguments?.query;
    sentences.push(
      query
        ? `I could not find a company or person matching ${query}.`
        : 'I could not find that record.',
    );
  }

  if (open?.error) {
    sentences.push(open.error);
  } else if (open?.record) {
    const who =
      open.record.object === 'person' && open.companyLabel
        ? `${open.record.label} at ${open.companyLabel}`
        : open.record.label;
    const { opportunityBits, taskBits } = describeOpenItems(open);
    const opportunitySentence =
      open.opportunities.length === 0
        ? 'no open opportunities'
        : `${open.opportunities.length} open ${
            open.opportunities.length === 1 ? 'opportunity' : 'opportunities'
          }`;
    const taskSentence =
      open.tasks.length === 0
        ? 'no open tasks'
        : `${open.tasks.length} open ${open.tasks.length === 1 ? 'task' : 'tasks'}${
            taskBits.length ? `: ${taskBits.join(', ')}` : ''
          }`;
    sentences.push(`${who} has ${opportunitySentence} and ${taskSentence}.`);
    if (opportunityBits.length) {
      sentences.push(`Open pipeline: ${opportunityBits.join('; ')}.`);
    }
  } else if (lookup?.match && !open && !note && !task) {
    sentences.push(`I found ${lookup.match.label}.`);
  }

  if (note?.error) {
    sentences.push(`I could not save the note. ${note.error}`);
  } else if (note) {
    sentences.push(`I logged a note on ${note.label}: ${note.body}.`);
  }

  if (task?.error) {
    sentences.push(`I could not create the task. ${task.error}`);
  } else if (task) {
    const due = task.dueAt ? `, due ${formatSpokenDate(task.dueAt)}` : '';
    sentences.push(`I created a task, ${task.title}${due}.`);
  }

  if (!sentences.length) {
    sentences.push(
      'I can look up a company or person, log a note, or create a task. Try naming a record, such as Acme Robotics.',
    );
  }

  if (sample) {
    sentences.push('These are sample records, not a live customer workspace.');
  }

  return sentences.join(' ');
}

function nextCall(name, args) {
  return {
    content: null,
    toolCalls: [{ id: `offline-${name}`, name, arguments: args }],
  };
}

export function planOfflineTurn({ messages, now, fallbackRecord }) {
  const userText =
    [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const query = extractQuery(userText);
  const note = extractNote(userText);
  const lookup = resultOf(messages, 'lookup_record');

  if (!alreadyCalled(messages, 'lookup_record') && (query || fallbackRecord?.id)) {
    if (query) {
      return nextCall('lookup_record', { query });
    }
    return nextCall('lookup_record', {
      recordId: fallbackRecord.id,
      object: fallbackRecord.object,
    });
  }

  if (lookup && !lookup.match) {
    return { content: buildOfflineReply(messages), toolCalls: null };
  }

  const record = lookup?.match;

  if (wantsOpen(userText) && record && !alreadyCalled(messages, 'list_open_items')) {
    return nextCall('list_open_items', {
      recordId: record.id,
      object: record.object,
    });
  }

  if (wantsNote(userText) && record && !alreadyCalled(messages, 'add_note')) {
    return nextCall('add_note', {
      recordId: record.id,
      object: record.object,
      title: 'Call note',
      body: note || userText,
    });
  }

  if (wantsTask(userText) && record && !alreadyCalled(messages, 'create_task')) {
    return nextCall('create_task', {
      recordId: record.id,
      object: record.object,
      title: taskTitle(userText),
      body: taskTitle(userText),
      dueAt: resolveDueAt(userText, now) ?? resolveDueAt('tomorrow', now),
    });
  }

  return { content: buildOfflineReply(messages), toolCalls: null };
}

export function createOfflineLlm({ now, fallbackRecord }) {
  return {
    provider: 'mock',
    model: 'offline-mock',
    async complete({ messages }) {
      const turn = planOfflineTurn({ messages, now, fallbackRecord });
      return {
        content: turn.content,
        toolCalls: turn.toolCalls,
        provider: 'mock',
        model: 'offline-mock',
      };
    },
  };
}
