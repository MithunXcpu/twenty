import { randomUUID } from 'node:crypto';

export const SAMPLE_IDS = {
  acme: '11111111-1111-4111-8111-111111111111',
  northwind: '22222222-2222-4222-8222-222222222222',
  priya: '33333333-3333-4333-8333-333333333333',
  sam: '44444444-4444-4444-8444-444444444444',
};

const SAMPLE_NOTICE = 'Sample demo data. These are not real customers.';

function currency(amount, currencyCode = 'USD') {
  return { amountMicros: Math.round(amount * 1_000_000), currencyCode };
}

export function createDemoStore() {
  const { acme, northwind, priya, sam } = SAMPLE_IDS;

  return {
    companies: [
      {
        id: acme,
        name: 'Acme Robotics',
        domainName: { primaryLinkUrl: 'acme.example' },
      },
      {
        id: northwind,
        name: 'Northwind Traders',
        domainName: { primaryLinkUrl: 'northwind.example' },
      },
    ],
    people: [
      {
        id: priya,
        name: { firstName: 'Priya', lastName: 'Shah' },
        jobTitle: 'VP Engineering',
        emails: { primaryEmail: 'priya.shah@acme.example' },
        companyId: acme,
      },
      {
        id: sam,
        name: { firstName: 'Sam', lastName: 'Lee' },
        jobTitle: 'Operations lead',
        emails: { primaryEmail: 'sam.lee@northwind.example' },
        companyId: northwind,
      },
    ],
    opportunities: [
      {
        id: randomUUID(),
        name: 'Warehouse robotics expansion',
        stage: 'PROPOSAL',
        amount: currency(48000),
        closeDate: '2026-12-15T00:00:00.000Z',
        companyId: acme,
      },
      {
        id: randomUUID(),
        name: 'Sensor kit pilot',
        stage: 'MEETING',
        amount: currency(12000),
        closeDate: '2027-01-20T00:00:00.000Z',
        companyId: acme,
      },
      {
        id: randomUUID(),
        name: 'Starter kit',
        stage: 'CUSTOMER',
        amount: currency(5000),
        closeDate: '2026-06-01T00:00:00.000Z',
        companyId: acme,
      },
      {
        id: randomUUID(),
        name: 'Spring catalog',
        stage: 'SCREENING',
        amount: currency(9000),
        closeDate: '2026-12-01T00:00:00.000Z',
        companyId: northwind,
      },
    ],
    tasks: [
      {
        id: 'task-questionnaire',
        title: 'Send security questionnaire',
        status: 'TODO',
        dueAt: '2026-11-18T17:00:00.000Z',
        bodyV2: { markdown: 'Send the sample security questionnaire.', blocknote: null },
      },
      {
        id: 'task-intro',
        title: 'Intro call',
        status: 'DONE',
        dueAt: '2026-10-02T17:00:00.000Z',
        bodyV2: { markdown: 'Completed intro call.', blocknote: null },
      },
      {
        id: 'task-review',
        title: 'Schedule architecture review',
        status: 'IN_PROGRESS',
        dueAt: '2026-11-20T17:00:00.000Z',
        bodyV2: { markdown: 'Architecture review with Priya.', blocknote: null },
      },
      {
        id: 'task-delivery',
        title: 'Confirm delivery window',
        status: 'TODO',
        dueAt: '2026-11-19T17:00:00.000Z',
        bodyV2: { markdown: 'Confirm the sample delivery window.', blocknote: null },
      },
    ],
    taskTargets: [
      { id: randomUUID(), taskId: 'task-questionnaire', targetCompanyId: acme },
      { id: randomUUID(), taskId: 'task-intro', targetCompanyId: acme },
      { id: randomUUID(), taskId: 'task-review', targetPersonId: priya },
      { id: randomUUID(), taskId: 'task-delivery', targetCompanyId: northwind },
    ],
    notes: [
      {
        id: randomUUID(),
        title: 'Pilot timeline',
        bodyV2: {
          markdown: 'Intro call went well. They asked for a pilot timeline.',
          blocknote: null,
        },
        createdAt: '2026-10-02T18:00:00.000Z',
      },
    ],
    noteTargets: [],
  };
}

function companyLabel(store, companyId) {
  return store.companies.find((company) => company.id === companyId)?.name ?? null;
}

function personLabel(person) {
  return [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ');
}

function domainOf(company) {
  return company.domainName?.primaryLinkUrl ?? null;
}

function briefCompany(store, company) {
  return {
    id: company.id,
    object: 'company',
    label: company.name,
    domainName: domainOf(company),
    sample: true,
    notice: SAMPLE_NOTICE,
    people: store.people
      .filter((person) => person.companyId === company.id)
      .slice(0, 5)
      .map((person) => ({
        id: person.id,
        label: personLabel(person),
        jobTitle: person.jobTitle,
      })),
  };
}

function briefPerson(store, person) {
  return {
    id: person.id,
    object: 'person',
    label: personLabel(person),
    jobTitle: person.jobTitle,
    email: person.emails?.primaryEmail ?? null,
    companyId: person.companyId,
    companyLabel: companyLabel(store, person.companyId),
    sample: true,
    notice: SAMPLE_NOTICE,
  };
}

function scoreLabel(label, query) {
  const left = label.toLowerCase();
  const right = query.toLowerCase();
  if (left === right) {
    return 100;
  }
  if (left.startsWith(right)) {
    return 80;
  }
  if (left.includes(right)) {
    return 60;
  }
  const tokens = right.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => left.includes(token))) {
    return 50;
  }
  return 0;
}

function money(amount) {
  if (!amount || amount.amountMicros == null) {
    return null;
  }
  return {
    amount: amount.amountMicros / 1_000_000,
    currencyCode: amount.currencyCode ?? 'USD',
  };
}

export function createDemoCrm(store) {
  function findById(recordId) {
    const company = store.companies.find((item) => item.id === recordId);
    if (company) {
      return briefCompany(store, company);
    }
    const person = store.people.find((item) => item.id === recordId);
    if (person) {
      return briefPerson(store, person);
    }
    return null;
  }

  function lookup({ query, object, recordId }) {
    if (recordId) {
      const match = findById(recordId);
      if (!match || (object && match.object !== object)) {
        return { match: null, alternates: [], sample: true, notice: SAMPLE_NOTICE };
      }
      return { match, alternates: [], sample: true, notice: SAMPLE_NOTICE };
    }

    const needle = (query ?? '').trim();
    if (needle.length < 2) {
      return {
        match: null,
        alternates: [],
        sample: true,
        error: 'Search needs at least 2 characters.',
      };
    }

    const candidates = [];
    if (object !== 'person') {
      for (const company of store.companies) {
        const score = Math.max(
          scoreLabel(company.name, needle),
          scoreLabel(domainOf(company) ?? '', needle),
        );
        if (score > 0) {
          candidates.push({ score, match: briefCompany(store, company) });
        }
      }
    }
    if (object !== 'company') {
      for (const person of store.people) {
        const score = scoreLabel(personLabel(person), needle);
        if (score > 0) {
          candidates.push({ score, match: briefPerson(store, person) });
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return {
      match: candidates[0]?.match ?? null,
      alternates: candidates.slice(1, 4).map((candidate) => ({
        id: candidate.match.id,
        object: candidate.match.object,
        label: candidate.match.label,
      })),
      sample: true,
      notice: SAMPLE_NOTICE,
    };
  }

  function tasksFor(object, recordId) {
    const field = object === 'person' ? 'targetPersonId' : 'targetCompanyId';
    return store.taskTargets
      .filter((target) => target[field] === recordId)
      .map((target) => store.tasks.find((task) => task.id === target.taskId))
      .filter((task) => task && task.status !== 'DONE')
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
      }));
  }

  function opportunitiesFor(companyId) {
    return store.opportunities
      .filter(
        (opportunity) =>
          opportunity.companyId === companyId && opportunity.stage !== 'CUSTOMER',
      )
      .map((opportunity) => ({
        id: opportunity.id,
        name: opportunity.name,
        stage: opportunity.stage,
        amount: money(opportunity.amount),
        closeDate: opportunity.closeDate,
      }));
  }

  function listOpenItems({ recordId, object }) {
    const match = findById(recordId);
    if (!match || (object && match.object !== object)) {
      return { error: 'Record not found.', sample: true };
    }

    const companyId = match.object === 'company' ? match.id : match.companyId;
    return {
      record: { id: match.id, object: match.object, label: match.label },
      companyLabel: match.object === 'person' ? match.companyLabel : match.label,
      opportunities: companyId ? opportunitiesFor(companyId) : [],
      tasks: tasksFor(match.object, match.id),
      sample: true,
      notice: SAMPLE_NOTICE,
    };
  }

  function linkTarget(record, foreignIdField, foreignId) {
    return {
      id: randomUUID(),
      [foreignIdField]: foreignId,
      ...(record.object === 'person'
        ? { targetPersonId: record.id }
        : { targetCompanyId: record.id }),
    };
  }

  function addNote({ recordId, object, title, body }) {
    const match = findById(recordId);
    if (!match || (object && match.object !== object)) {
      return { error: 'Record not found.', sample: true };
    }
    if (!body?.trim()) {
      return { error: 'A note needs text.', sample: true };
    }

    const note = {
      id: randomUUID(),
      title: title?.trim() || 'Call note',
      bodyV2: { markdown: body.trim(), blocknote: null },
      createdAt: new Date().toISOString(),
    };
    store.notes.unshift(note);
    store.noteTargets.unshift(linkTarget(match, 'noteId', note.id));

    return {
      id: note.id,
      title: note.title,
      body: body.trim(),
      recordId: match.id,
      object: match.object,
      label: match.label,
      sample: true,
    };
  }

  function createTask({ recordId, object, title, body, dueAt }) {
    const match = findById(recordId);
    if (!match || (object && match.object !== object)) {
      return { error: 'Record not found.', sample: true };
    }

    const taskTitle = title?.trim() || 'Follow up';
    const task = {
      id: randomUUID(),
      title: taskTitle,
      status: 'TODO',
      dueAt: dueAt ?? null,
      bodyV2: { markdown: body?.trim() || taskTitle, blocknote: null },
    };
    store.tasks.unshift(task);
    store.taskTargets.unshift(linkTarget(match, 'taskId', task.id));

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt,
      recordId: match.id,
      object: match.object,
      label: match.label,
      sample: true,
    };
  }

  function listRecords() {
    return [
      ...store.companies.map((company) => ({
        id: company.id,
        object: 'company',
        label: company.name,
        sample: true,
      })),
      ...store.people.map((person) => ({
        id: person.id,
        object: 'person',
        label: personLabel(person),
        sample: true,
      })),
    ];
  }

  return {
    mode: 'demo',
    sample: true,
    lookup,
    listOpenItems,
    addNote,
    createTask,
    listRecords,
  };
}
