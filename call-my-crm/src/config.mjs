const NVIDIA_DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';

function trimmed(env, name) {
  return (env[name] ?? '').trim();
}

function withoutTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function llmConfig(env) {
  const apiKey = trimmed(env, 'NVIDIA_API_KEY');
  const baseUrl = withoutTrailingSlash(
    trimmed(env, 'NVIDIA_BASE_URL') || NVIDIA_DEFAULT_BASE,
  );
  const model = trimmed(env, 'NVIDIA_MODEL') || 'meta/llama-3.3-70b-instruct';
  const requested = (trimmed(env, 'LLM_PROVIDER') || 'auto').toLowerCase();
  let provider = 'mock';

  if (requested === 'nvidia') {
    provider = 'nvidia';
  } else if (requested === 'mock') {
    provider = 'mock';
  } else {
    provider = apiKey ? 'nvidia' : 'mock';
  }

  return { provider, requested, model, apiKey, baseUrl };
}

function crmConfig(env) {
  const baseUrl = withoutTrailingSlash(trimmed(env, 'TWENTY_API_URL'));
  const apiKey = trimmed(env, 'TWENTY_API_KEY');
  const requested = (trimmed(env, 'CRM_PROVIDER') || 'auto').toLowerCase();
  let provider = 'demo';

  if (requested === 'twenty') {
    provider = 'twenty';
  } else if (requested === 'demo') {
    provider = 'demo';
  } else {
    provider = baseUrl && apiKey ? 'twenty' : 'demo';
  }

  return {
    provider,
    requested,
    baseUrl,
    apiKey,
    sample: provider === 'demo',
  };
}

function sttConfig(env, nvidia) {
  const requested = (trimmed(env, 'STT_PROVIDER') || 'auto').toLowerCase();
  const whisperBase = withoutTrailingSlash(trimmed(env, 'WHISPER_BASE_URL'));
  const whisperKey = trimmed(env, 'WHISPER_API_KEY');
  const asrModel = trimmed(env, 'NVIDIA_ASR_MODEL') || 'openai/whisper-large-v3';
  const whisperModel = trimmed(env, 'WHISPER_MODEL') || 'whisper-1';

  if (requested === 'browser') {
    return { mode: 'browser', provider: 'browser', ready: true, requested };
  }

  if (requested === 'nvidia') {
    return {
      mode: 'server',
      provider: 'nvidia',
      ready: Boolean(nvidia.apiKey),
      requested,
      url: `${nvidia.baseUrl}/audio/transcriptions`,
      apiKey: nvidia.apiKey,
      model: asrModel,
    };
  }

  if (requested === 'whisper') {
    return {
      mode: 'server',
      provider: 'whisper',
      ready: Boolean(whisperBase && whisperKey),
      requested,
      url: whisperBase ? `${whisperBase}/audio/transcriptions` : '',
      apiKey: whisperKey,
      model: whisperModel,
    };
  }

  if (whisperBase && whisperKey) {
    return {
      mode: 'server',
      provider: 'whisper',
      ready: true,
      requested,
      url: `${whisperBase}/audio/transcriptions`,
      apiKey: whisperKey,
      model: whisperModel,
    };
  }

  return { mode: 'browser', provider: 'browser', ready: true, requested };
}

function ttsConfig(env) {
  const requested = (trimmed(env, 'TTS_PROVIDER') || 'browser').toLowerCase();
  const elevenKey = trimmed(env, 'ELEVENLABS_API_KEY');
  const voiceId = trimmed(env, 'ELEVENLABS_VOICE_ID');
  const elevenModel =
    trimmed(env, 'ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2';
  const httpUrl = trimmed(env, 'TTS_HTTP_URL');
  const httpKey = trimmed(env, 'TTS_HTTP_API_KEY');

  if (requested === 'elevenlabs' && elevenKey && voiceId) {
    return {
      mode: 'server',
      provider: 'elevenlabs',
      ready: true,
      requested,
      apiKey: elevenKey,
      voiceId,
      model: elevenModel,
    };
  }

  if (requested === 'http' && httpUrl) {
    return {
      mode: 'server',
      provider: 'http',
      ready: true,
      requested,
      url: httpUrl,
      apiKey: httpKey,
    };
  }

  const detail =
    requested === 'elevenlabs'
      ? 'ElevenLabs needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID. Using the browser voice.'
      : requested === 'http'
        ? 'HTTP TTS needs TTS_HTTP_URL. Using the browser voice.'
        : '';

  return {
    mode: 'browser',
    provider: 'browser',
    ready: true,
    requested,
    detail,
  };
}

export function loadConfig(env = process.env) {
  const llm = llmConfig(env);
  const port = Number(env.PORT || 8787);

  return {
    port: Number.isInteger(port) && port > 0 ? port : 8787,
    llm,
    crm: crmConfig(env),
    stt: sttConfig(env, llm),
    tts: ttsConfig(env),
    teamsSecret: trimmed(env, 'TEAMS_WEBHOOK_SECRET'),
  };
}

export function publicConfig(config) {
  return {
    service: 'call-my-crm',
    llm: {
      provider: config.llm.provider,
      model:
        config.llm.provider === 'nvidia' ? config.llm.model : 'offline-mock',
    },
    crm: {
      provider: config.crm.provider,
      sample: config.crm.sample,
    },
    stt: {
      mode: config.stt.ready && config.stt.mode === 'server' ? 'server' : 'browser',
      provider: config.stt.provider,
      ready: config.stt.ready,
    },
    tts: {
      mode: config.tts.mode,
      provider: config.tts.provider,
      ready: config.tts.ready,
      detail: config.tts.detail ?? '',
    },
    teams: {
      secretRequired: Boolean(config.teamsSecret),
    },
  };
}
