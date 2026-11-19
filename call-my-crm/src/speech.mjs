function fileNameFor(type) {
  if (type.includes('wav')) {
    return 'speech.wav';
  }
  if (type.includes('mpeg') || type.includes('mp3')) {
    return 'speech.mp3';
  }
  return 'speech.webm';
}

export async function transcribeAudio({ audio, contentType, stt, fetchImpl = fetch }) {
  if (!stt.ready || stt.mode !== 'server') {
    return {
      error: 'Server speech-to-text is not configured.',
      fallback: 'browser',
    };
  }

  const form = new FormData();
  const type = contentType?.split(';')[0] || 'audio/webm';
  form.append('file', new Blob([audio], { type }), fileNameFor(type));
  form.append('model', stt.model);

  const response = await fetchImpl(stt.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${stt.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
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
    throw new Error(`Speech-to-text failed (${response.status}): ${detail}`);
  }

  const transcript = payload?.text?.trim();
  if (!transcript) {
    throw new Error('Speech-to-text returned an empty transcript.');
  }

  return { text: transcript, provider: stt.provider };
}

export async function synthesizeSpeech({ text, tts, fetchImpl = fetch }) {
  if (tts.mode !== 'server') {
    return { mode: 'browser', text };
  }

  if (tts.provider === 'elevenlabs') {
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${tts.voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': tts.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: tts.model,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180);
      throw new Error(`ElevenLabs failed (${response.status}): ${detail}`);
    }
    return {
      mode: 'audio',
      contentType: 'audio/mpeg',
      audio: Buffer.from(await response.arrayBuffer()),
    };
  }

  const response = await fetchImpl(tts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'audio/mpeg',
      ...(tts.apiKey ? { authorization: `Bearer ${tts.apiKey}` } : {}),
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`TTS failed (${response.status}): ${detail}`);
  }

  return {
    mode: 'audio',
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    audio: Buffer.from(await response.arrayBuffer()),
  };
}
