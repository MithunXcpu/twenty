import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConfig } from '../src/config.mjs';
import { synthesizeSpeech, transcribeAudio } from '../src/speech.mjs';

describe('speech providers', () => {
  it('posts Whisper-compatible audio to NVIDIA ASR', async () => {
    const config = loadConfig({
      STT_PROVIDER: 'nvidia',
      NVIDIA_API_KEY: 'asr-key',
      NVIDIA_ASR_MODEL: 'openai/whisper-large-v3',
    });
    let seen;
    const result = await transcribeAudio({
      audio: Buffer.from('fake-audio'),
      contentType: 'audio/webm',
      stt: config.stt,
      fetchImpl: async (url, init) => {
        seen = { url: String(url), authorization: init.headers.authorization };
        const form = init.body;
        seen.model = form.get('model');
        seen.file = form.get('file');
        return new Response(JSON.stringify({ text: 'log a note on Acme' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.equal(
      seen.url,
      'https://integrate.api.nvidia.com/v1/audio/transcriptions',
    );
    assert.equal(seen.authorization, 'Bearer asr-key');
    assert.equal(seen.model, 'openai/whisper-large-v3');
    assert.ok(seen.file);
    assert.equal(result.text, 'log a note on Acme');
  });

  it('asks the browser to speak when no server voice is configured', async () => {
    const config = loadConfig({ TTS_PROVIDER: 'browser' });
    const spoken = await synthesizeSpeech({
      text: 'Hello',
      tts: config.tts,
    });
    assert.equal(spoken.mode, 'browser');
  });

  it('calls an ElevenLabs-style endpoint when that provider is configured', async () => {
    const config = loadConfig({
      TTS_PROVIDER: 'elevenlabs',
      ELEVENLABS_API_KEY: 'voice-key',
      ELEVENLABS_VOICE_ID: 'voice-1',
      ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
    });
    let seen;
    const spoken = await synthesizeSpeech({
      text: 'Follow up is set.',
      tts: config.tts,
      fetchImpl: async (url, init) => {
        seen = {
          url: String(url),
          key: init.headers['xi-api-key'],
          body: JSON.parse(init.body),
        };
        return new Response(Buffer.from('audio-bytes'), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      },
    });

    assert.equal(seen.url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-1');
    assert.equal(seen.key, 'voice-key');
    assert.equal(seen.body.text, 'Follow up is set.');
    assert.equal(spoken.mode, 'audio');
    assert.equal(spoken.audio.toString(), 'audio-bytes');
  });
});
