import { createDemoCrm, createDemoStore } from './demo-crm.mjs';
import { createTwentyClient } from './twenty-client.mjs';

function unavailable(message) {
  return {
    mode: 'twenty',
    sample: false,
    misconfigured: true,
    lookup: async () => ({ match: null, alternates: [], error: message }),
    listOpenItems: async () => ({ error: message }),
    addNote: async () => ({ error: message }),
    createTask: async () => ({ error: message }),
    listRecords: () => [],
  };
}

export function createCrm(config, { store, fetchImpl } = {}) {
  if (config.crm.provider === 'twenty') {
    if (!config.crm.baseUrl || !config.crm.apiKey) {
      return unavailable(
        'Set TWENTY_API_URL and TWENTY_API_KEY, or set CRM_PROVIDER=demo.',
      );
    }

    return createTwentyClient({
      baseUrl: config.crm.baseUrl,
      apiKey: config.crm.apiKey,
      fetchImpl,
    });
  }

  return createDemoCrm(store ?? createDemoStore());
}
