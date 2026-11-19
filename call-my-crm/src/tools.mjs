import { formatSpokenDate, resolveDueAt } from './dates.mjs';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'lookup_record',
      description:
        'Find a company or person in the CRM by name, domain, or record id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name or domain to search for.' },
          recordId: { type: 'string', description: 'Known record id.' },
          object: {
            type: 'string',
            enum: ['company', 'person'],
            description: 'Limit the search to one object.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_open_items',
      description:
        'List open opportunities and open tasks for a company or person. Opportunities stay on the company.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          query: { type: 'string' },
          object: { type: 'string', enum: ['company', 'person'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Attach a note to a company or person.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          query: { type: 'string' },
          object: { type: 'string', enum: ['company', 'person'] },
          title: { type: 'string' },
          body: { type: 'string', description: 'Note text.' },
        },
        required: ['body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a follow-up task linked to a company or person.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          query: { type: 'string' },
          object: { type: 'string', enum: ['company', 'person'] },
          title: { type: 'string' },
          body: { type: 'string' },
          dueAt: {
            type: 'string',
            description: 'ISO-8601 time, or a phrase such as Friday or tomorrow.',
          },
        },
        required: ['title'],
      },
    },
  },
];

function stageLabel(stage) {
  return String(stage)
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function moneyLabel(amount) {
  if (!amount || amount.amount == null) {
    return '';
  }
  return `${Math.round(Number(amount.amount))} ${amount.currencyCode ?? 'USD'}`;
}

export function summarizeTool(name, result) {
  if (!result) {
    return 'No result';
  }
  if (result.error) {
    return result.error;
  }
  if (name === 'lookup_record') {
    return result.match ? `Found ${result.match.label}` : 'No matching record';
  }
  if (name === 'list_open_items') {
    const opportunities = result.opportunities?.length ?? 0;
    const tasks = result.tasks?.length ?? 0;
    return `${opportunities} open opportunities, ${tasks} open tasks`;
  }
  if (name === 'add_note') {
    return `Note saved on ${result.label}`;
  }
  if (name === 'create_task') {
    const due = result.dueAt ? `, due ${formatSpokenDate(result.dueAt)}` : '';
    return `Task "${result.title}" created${due}`;
  }
  return 'Done';
}

export function describeOpenItems(result) {
  const opportunityBits = (result.opportunities ?? []).slice(0, 2).map((item) => {
    const amount = moneyLabel(item.amount);
    const stage = stageLabel(item.stage);
    return amount ? `${item.name} (${stage}, ${amount})` : `${item.name} (${stage})`;
  });
  const taskBits = (result.tasks ?? []).slice(0, 3).map((task) => task.title);
  return { opportunityBits, taskBits };
}

async function resolveRecord(crm, args, fallbackRecord) {
  if (args.recordId) {
    const found = await crm.lookup({
      recordId: args.recordId,
      object: args.object,
    });
    if (found.error || found.match) {
      return found;
    }
  }

  if (args.query) {
    const found = await crm.lookup({ query: args.query, object: args.object });
    if (found.error || found.match) {
      return found;
    }
  }

  if (fallbackRecord?.id) {
    return crm.lookup({
      recordId: fallbackRecord.id,
      object: fallbackRecord.object,
    });
  }

  return { match: null, error: 'No company or person was specified.' };
}

export async function executeTool(name, args, { crm, now, fallbackRecord }) {
  const input = args ?? {};

  if (name === 'lookup_record') {
    if (input.recordId || input.query) {
      return crm.lookup({
        recordId: input.recordId,
        query: input.query,
        object: input.object,
      });
    }
    if (fallbackRecord?.id) {
      return crm.lookup({
        recordId: fallbackRecord.id,
        object: fallbackRecord.object,
      });
    }
    return {
      match: null,
      alternates: [],
      error: 'No company or person was specified.',
    };
  }

  const resolved = await resolveRecord(crm, input, fallbackRecord);
  if (resolved.error) {
    return { error: resolved.error, sample: crm.sample };
  }
  if (!resolved.match) {
    return { error: 'Record not found.', sample: crm.sample };
  }

  if (name === 'list_open_items') {
    return crm.listOpenItems({
      recordId: resolved.match.id,
      object: resolved.match.object,
    });
  }

  if (name === 'add_note') {
    return crm.addNote({
      recordId: resolved.match.id,
      object: resolved.match.object,
      title: input.title,
      body: input.body,
    });
  }

  if (name === 'create_task') {
    return crm.createTask({
      recordId: resolved.match.id,
      object: resolved.match.object,
      title: input.title,
      body: input.body,
      dueAt: resolveDueAt(input.dueAt, now),
    });
  }

  return { error: `Unknown tool ${name}` };
}
