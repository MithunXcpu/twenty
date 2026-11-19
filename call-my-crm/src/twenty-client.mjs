function restRoot(baseUrl) {
  const trimmed = baseUrl.replace(/\/$/, '');
  return trimmed.endsWith('/rest') ? trimmed : `${trimmed}/rest`;
}

// Twenty's filter grammar treats quotes, commas, and parentheses as syntax.
function sanitizeSearch(query) {
  return (query ?? '')
    .replace(/["(),[\]\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function personLabel(person) {
  if (typeof person.name === 'string') {
    return person.name;
  }
  return [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ');
}

function money(amount) {
  if (amount == null) {
    return null;
  }
  if (typeof amount === 'number') {
    return { amount, currencyCode: 'USD' };
  }
  if (typeof amount === 'object' && amount.amountMicros != null) {
    return {
      amount: amount.amountMicros / 1_000_000,
      currencyCode: amount.currencyCode ?? 'USD',
    };
  }
  return null;
}

function scoreLabel(label, query) {
  const left = (label ?? '').toLowerCase();
  const right = query.toLowerCase();
  if (!left) {
    return 0;
  }
  if (left === right) {
    return 100;
  }
  if (left.startsWith(right)) {
    return 80;
  }
  if (left.includes(right)) {
    return 60;
  }
  return 0;
}

export function createTwentyClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const root = restRoot(baseUrl);

  async function request(method, path, body, query) {
    const url = new URL(`${root}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 300) };
      }
    }

    if (!response.ok) {
      const detail =
        payload?.messages?.[0]?.message ||
        payload?.error ||
        payload?.raw ||
        response.statusText;
      const error = new Error(
        `Twenty ${method} ${path} failed (${response.status}): ${detail}`,
      );
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  async function safeRequest(method, path, body, query) {
    try {
      return { ok: true, payload: await request(method, path, body, query) };
    } catch (error) {
      if (error.status === 404) {
        return { ok: false, notFound: true, error };
      }
      throw error;
    }
  }

  function records(payload, plural) {
    return payload?.data?.[plural] ?? [];
  }

  function created(payload, singular) {
    const key = `create${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;
    return payload?.data?.[key] ?? null;
  }

  async function searchCompanies(needle) {
    const byName = await request('GET', '/companies', null, {
      filter: `name[ilike]:"%${needle}%"`,
      limit: 10,
    });
    const companies = records(byName, 'companies');
    if (companies.length > 0 || !needle.includes('.')) {
      return companies;
    }

    try {
      const byDomain = await request('GET', '/companies', null, {
        filter: `domainName.primaryLinkUrl[ilike]:"%${needle}%"`,
        limit: 10,
      });
      return records(byDomain, 'companies');
    } catch {
      return companies;
    }
  }

  async function searchPeople(needle) {
    const tokens = needle.split(' ').filter(Boolean).slice(0, 3);
    const clauses = tokens.flatMap((token) => [
      `name.firstName[ilike]:"%${token}%"`,
      `name.lastName[ilike]:"%${token}%"`,
    ]);
    const payload = await request('GET', '/people', null, {
      filter: `or(${clauses.join(',')})`,
      limit: 10,
      depth: 1,
    });
    return records(payload, 'people');
  }

  async function getCompany(id) {
    const result = await safeRequest('GET', `/companies/${id}`, null, { depth: 1 });
    return result.ok ? (result.payload?.data?.company ?? null) : null;
  }

  async function getPerson(id) {
    const result = await safeRequest('GET', `/people/${id}`, null, { depth: 1 });
    return result.ok ? (result.payload?.data?.person ?? null) : null;
  }

  function companyMatch(company, people = []) {
    return {
      id: company.id,
      object: 'company',
      label: company.name,
      domainName: company.domainName?.primaryLinkUrl ?? null,
      sample: false,
      people: people.slice(0, 5).map((person) => ({
        id: person.id,
        label: personLabel(person),
        jobTitle: person.jobTitle ?? null,
      })),
    };
  }

  function personMatch(person) {
    const company =
      person.company && typeof person.company === 'object' ? person.company : null;
    return {
      id: person.id,
      object: 'person',
      label: personLabel(person) || 'Person',
      jobTitle: person.jobTitle ?? null,
      email: person.emails?.primaryEmail ?? null,
      companyId: person.companyId ?? company?.id ?? null,
      companyLabel: company?.name ?? null,
      sample: false,
    };
  }

  async function peopleAtCompany(companyId) {
    try {
      const payload = await request('GET', '/people', null, {
        filter: `companyId[eq]:"${companyId}"`,
        limit: 5,
      });
      return records(payload, 'people');
    } catch {
      return [];
    }
  }

  async function lookup({ query, object, recordId }) {
    try {
      if (recordId) {
        if (object !== 'person') {
          const company = await getCompany(recordId);
          if (company) {
            return {
              match: companyMatch(company, await peopleAtCompany(company.id)),
              alternates: [],
              sample: false,
            };
          }
        }
        if (object !== 'company') {
          const person = await getPerson(recordId);
          if (person) {
            return { match: personMatch(person), alternates: [], sample: false };
          }
        }
        return { match: null, alternates: [], sample: false };
      }

      const needle = sanitizeSearch(query);
      if (needle.length < 2) {
        return {
          match: null,
          alternates: [],
          sample: false,
          error: 'Search needs at least 2 characters.',
        };
      }

      const companies = object === 'person' ? [] : await searchCompanies(needle);
      const people = object === 'company' ? [] : await searchPeople(needle);
      const ranked = [
        ...companies.map((company) => ({
          score: Math.max(
            scoreLabel(company.name, needle),
            scoreLabel(company.domainName?.primaryLinkUrl ?? '', needle),
          ),
          kind: 'company',
          record: company,
        })),
        ...people.map((person) => ({
          score: scoreLabel(personLabel(person), needle),
          kind: 'person',
          record: person,
        })),
      ]
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);

      const best = ranked[0];
      if (!best) {
        return { match: null, alternates: [], sample: false };
      }

      const match =
        best.kind === 'company'
          ? companyMatch(best.record, await peopleAtCompany(best.record.id))
          : personMatch(best.record);

      return {
        match,
        alternates: ranked.slice(1, 4).map((item) => ({
          id: item.record.id,
          object: item.kind,
          label: item.kind === 'company' ? item.record.name : personLabel(item.record),
        })),
        sample: false,
      };
    } catch (error) {
      return { match: null, alternates: [], sample: false, error: error.message };
    }
  }

  async function listOpenItems({ recordId, object }) {
    try {
      const found = await lookup({ recordId, object });
      if (found.error) {
        return { error: found.error, sample: false };
      }
      if (!found.match) {
        return { error: 'Record not found.', sample: false };
      }

      const match = found.match;
      const companyId = match.object === 'company' ? match.id : match.companyId;
      const targetField =
        match.object === 'person' ? 'targetPersonId' : 'targetCompanyId';
      const [opportunityPayload, taskPayload] = await Promise.all([
        companyId
          ? request('GET', '/opportunities', null, {
              filter: `companyId[eq]:"${companyId}"`,
              limit: 20,
            })
          : Promise.resolve(null),
        request('GET', '/taskTargets', null, {
          filter: `${targetField}[eq]:"${match.id}"`,
          limit: 20,
          depth: 1,
        }),
      ]);

      const opportunities = (
        opportunityPayload ? records(opportunityPayload, 'opportunities') : []
      )
        .filter((opportunity) => opportunity.stage !== 'CUSTOMER')
        .map((opportunity) => ({
          id: opportunity.id,
          name: opportunity.name,
          stage: opportunity.stage,
          amount: money(opportunity.amount),
          closeDate: opportunity.closeDate ?? null,
        }));

      const tasks = [];
      for (const target of records(taskPayload, 'taskTargets')) {
        let task = target.task && typeof target.task === 'object' ? target.task : null;
        if (!task && target.taskId) {
          const loaded = await safeRequest('GET', `/tasks/${target.taskId}`);
          task = loaded.ok ? loaded.payload?.data?.task : null;
        }
        if (!task || task.status === 'DONE') {
          continue;
        }
        tasks.push({
          id: task.id,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt ?? null,
        });
      }

      return {
        record: { id: match.id, object: match.object, label: match.label },
        companyLabel: match.object === 'person' ? match.companyLabel : match.label,
        opportunities,
        tasks,
        sample: false,
      };
    } catch (error) {
      return { error: error.message, sample: false };
    }
  }

  function targetBody(object, recordId, foreignIdField, foreignId) {
    const targetField = object === 'person' ? 'targetPersonId' : 'targetCompanyId';
    return {
      [foreignIdField]: foreignId,
      [targetField]: recordId,
    };
  }

  async function addNote({ recordId, object, title, body }) {
    try {
      if (!body?.trim()) {
        return { error: 'A note needs text.', sample: false };
      }
      const found = await lookup({ recordId, object });
      if (found.error) {
        return { error: found.error, sample: false };
      }
      if (!found.match) {
        return { error: 'Record not found.', sample: false };
      }

      const notePayload = await request('POST', '/notes', {
        title: title?.trim() || 'Call note',
        bodyV2: { markdown: body.trim(), blocknote: null },
      });
      const note = created(notePayload, 'note');
      if (!note?.id) {
        return { error: 'Twenty did not return a note id.', sample: false };
      }

      await request(
        'POST',
        '/noteTargets',
        targetBody(found.match.object, found.match.id, 'noteId', note.id),
      );

      return {
        id: note.id,
        title: note.title ?? title,
        body: body.trim(),
        recordId: found.match.id,
        object: found.match.object,
        label: found.match.label,
        sample: false,
      };
    } catch (error) {
      return { error: error.message, sample: false };
    }
  }

  async function createTask({ recordId, object, title, body, dueAt }) {
    try {
      const found = await lookup({ recordId, object });
      if (found.error) {
        return { error: found.error, sample: false };
      }
      if (!found.match) {
        return { error: 'Record not found.', sample: false };
      }

      const taskTitle = title?.trim() || 'Follow up';
      const taskPayload = await request('POST', '/tasks', {
        title: taskTitle,
        status: 'TODO',
        ...(dueAt ? { dueAt } : {}),
        bodyV2: { markdown: body?.trim() || taskTitle, blocknote: null },
      });
      const task = created(taskPayload, 'task');
      if (!task?.id) {
        return { error: 'Twenty did not return a task id.', sample: false };
      }

      await request(
        'POST',
        '/taskTargets',
        targetBody(found.match.object, found.match.id, 'taskId', task.id),
      );

      return {
        id: task.id,
        title: task.title ?? taskTitle,
        status: task.status ?? 'TODO',
        dueAt: task.dueAt ?? dueAt ?? null,
        recordId: found.match.id,
        object: found.match.object,
        label: found.match.label,
        sample: false,
      };
    } catch (error) {
      return { error: error.message, sample: false };
    }
  }

  return {
    mode: 'twenty',
    sample: false,
    lookup,
    listOpenItems,
    addNote,
    createTask,
    listRecords() {
      return [];
    },
  };
}
