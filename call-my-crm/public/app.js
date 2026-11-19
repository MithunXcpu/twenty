const params = new URLSearchParams(window.location.search);
const embed = params.get('embed') === '1';
const SAMPLE_REQUEST =
  "what's open on Acme, log that they want a security review, and create a follow-up for Friday";

const transcript = document.querySelector('#transcript');
const tools = document.querySelector('#tools');
const utterance = document.querySelector('#utterance');
const status = document.querySelector('#status');
const composer = document.querySelector('#composer');
const sendButton = document.querySelector('#send');
const callButtons = [
  document.querySelector('#call-fab'),
  document.querySelector('#call-inline'),
];
const recordPicker = document.querySelector('#record-picker');
const contextChip = document.querySelector('#context-chip');
const providers = document.querySelector('#providers');
const sampleBanner = document.querySelector('#sample-banner');
const runSample = document.querySelector('#run-sample');

const history = [];
let config = null;
let busy = false;
let listening = false;
let recognition = null;
let recorder = null;
let recorderChunks = [];
let recorderStream = null;

if (embed) {
  document.body.classList.add('embed');
}

function setStatus(text) {
  status.textContent = text;
}

function field(caption, control) {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = caption;
  label.append(span, control);
  return label;
}

function clearEmpty(list) {
  list.querySelectorAll('.empty').forEach((item) => item.remove());
}

function addTranscript(role, text, draft = false) {
  clearEmpty(transcript);
  const item = document.createElement('li');
  item.className = draft ? 'draft' : role;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Agent' : 'Hearing';
  item.append(who, document.createTextNode(text));
  const previous = transcript.querySelector('.draft');
  if (draft && previous) {
    previous.replaceWith(item);
    return;
  }
  if (!draft) {
    transcript.querySelectorAll('.draft').forEach((node) => node.remove());
  }
  transcript.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

function addTool(event) {
  clearEmpty(tools);
  const item = document.createElement('li');
  const name = document.createElement('div');
  name.className = 'tool-name';
  name.textContent = event.name;
  const summary = document.createElement('div');
  summary.textContent = event.summary;
  const details = document.createElement('details');
  const summaryNode = document.createElement('summary');
  summaryNode.textContent = 'Arguments and result';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(
    { arguments: event.arguments, result: event.result },
    null,
    2,
  );
  details.append(summaryNode, pre);
  item.append(name, summary, details);
  tools.append(item);
}

function currentRecord() {
  const objectField = document.querySelector('#record-object');
  const idField = document.querySelector('#record-id');
  const labelField = document.querySelector('#record-label');
  const select = document.querySelector('#record-context');

  if (select) {
    if (!select.value) {
      return null;
    }
    const [object, id] = select.value.split(':');
    const option = select.selectedOptions[0];
    return {
      object,
      id,
      label: option?.dataset.label || '',
    };
  }

  if (!objectField?.value || !idField?.value.trim()) {
    return null;
  }

  return {
    object: objectField.value,
    id: idField.value.trim(),
    label: labelField?.value.trim() || '',
  };
}

function paintContext() {
  const record = currentRecord();
  contextChip.textContent = record
    ? `${record.object === 'person' ? 'Person' : 'Company'} · ${record.label || record.id}`
    : 'Global call — no record open';
}

function renderProviders() {
  const rows = [
    ['LLM', config.llm.provider === 'nvidia' ? config.llm.model : 'offline mock'],
    ['CRM', config.crm.sample ? 'sample demo data' : 'Twenty API'],
    ['Speech', config.stt.mode === 'server' ? config.stt.provider : 'browser'],
    ['Voice', config.tts.mode === 'server' ? config.tts.provider : 'browser'],
  ];
  providers.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    providers.append(term, detail);
  }
  if (config.tts.detail) {
    setStatus(config.tts.detail);
  }
}

function renderRecordPicker(records) {
  const presetObject = params.get('object') || '';
  const presetId = params.get('recordId') || '';
  const presetLabel = params.get('label') || '';

  if (config.crm.sample) {
    const select = document.createElement('select');
    select.id = 'record-context';
    const globalOption = document.createElement('option');
    globalOption.value = '';
    globalOption.textContent = 'Global — no record open';
    select.append(globalOption);

    for (const record of records) {
      const option = document.createElement('option');
      option.value = `${record.object}:${record.id}`;
      option.dataset.label = record.label;
      option.textContent = `${record.object === 'person' ? 'Person' : 'Company'} · ${record.label} (sample)`;
      if (record.id === presetId) {
        option.selected = true;
      }
      select.append(option);
    }

    if (presetId && !records.some((record) => record.id === presetId)) {
      const option = document.createElement('option');
      option.value = `${presetObject || 'company'}:${presetId}`;
      option.dataset.label = presetLabel || presetId;
      option.textContent = presetLabel || presetId;
      option.selected = true;
      select.append(option);
    }

    select.addEventListener('change', paintContext);
    recordPicker.replaceChildren(field('Record in view', select));
  } else {
    const objectField = document.createElement('select');
    objectField.id = 'record-object';
    for (const [value, label] of [
      ['', 'Global'],
      ['company', 'Company'],
      ['person', 'Person'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      objectField.append(option);
    }
    const idField = document.createElement('input');
    idField.id = 'record-id';
    idField.placeholder = 'Twenty record id';
    const labelField = document.createElement('input');
    labelField.id = 'record-label';
    labelField.placeholder = 'Shown on the call';
    if (presetObject === 'company' || presetObject === 'person') {
      objectField.value = presetObject;
    }
    idField.value = presetId;
    labelField.value = presetLabel;
    for (const control of [objectField, idField, labelField]) {
      control.addEventListener('input', paintContext);
      control.addEventListener('change', paintContext);
    }
    recordPicker.replaceChildren(
      field('Object', objectField),
      field('Record id', idField),
      field('Label', labelField),
    );
  }

  sampleBanner.hidden = !config.crm.sample;
  runSample.hidden = !config.crm.sample;
  paintContext();
}

async function loadDesk() {
  const [configResponse, recordsResponse] = await Promise.all([
    fetch('/api/config'),
    fetch('/api/records'),
  ]);
  config = await configResponse.json();
  const recordsPayload = await recordsResponse.json();
  renderProviders();
  renderRecordPicker(recordsPayload.records ?? []);
  const speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (config.stt.mode === 'browser' && !speech) {
    setStatus(
      'This browser has no Web Speech API. Type the request, or configure server speech-to-text.',
    );
  } else if (!config.tts.detail) {
    setStatus(config.crm.sample ? 'Offline agent, sample CRM.' : 'Connected agent.');
  }
}

function setBusy(next) {
  busy = next;
  sendButton.disabled = next;
  runSample.disabled = next;
  for (const button of callButtons) {
    button.disabled = next && !listening;
  }
}

async function speak(text) {
  if (config.tts.mode === 'server') {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const type = response.headers.get('content-type') || '';
    if (type.includes('audio')) {
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      await audio.play();
      return;
    }
  }

  if ('speechSynthesis' in window) {
    const spoken = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(spoken);
  }
}

async function ask(text) {
  const cleaned = text.trim();
  if (!cleaned || busy) {
    return;
  }

  setBusy(true);
  addTranscript('user', cleaned);
  utterance.value = '';
  setStatus('Working…');

  try {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: cleaned,
        record: currentRecord(),
        history,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || `Request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line);
        if (event.type === 'tool') {
          addTool(event);
        }
        if (event.type === 'reply') {
          reply = event.text;
          addTranscript('assistant', event.text);
          const via = event.llm?.fallback ? 'offline fallback' : event.llm?.provider;
          setStatus(`Answered with ${via}.`);
        }
      }
    }

    history.push({ role: 'user', content: cleaned });
    if (reply) {
      history.push({ role: 'assistant', content: reply });
      await speak(reply);
    }
  } catch (error) {
    setStatus(error.message);
    addTranscript('assistant', error.message);
  } finally {
    setBusy(false);
    paintCall(false);
  }
}

function paintCall(active) {
  listening = active;
  for (const button of callButtons) {
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  document.querySelector('#call-fab .fab-label').textContent = active ? 'Stop' : 'Call';
  document.querySelector('#call-inline').textContent = active ? 'Stop' : 'Call';
}

function stopListening() {
  recognition?.stop();
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
}

async function listenWithBrowser() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error('unsupported');
  }

  return new Promise((resolve, reject) => {
    recognition = new SpeechRecognition();
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalText = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index][0].transcript;
        if (event.results[index].isFinal) {
          finalText += piece;
        } else {
          interim += piece;
        }
      }
      addTranscript('user', (finalText || interim).trim(), true);
    };
    recognition.onerror = (event) => reject(new Error(event.error || 'speech-error'));
    recognition.onend = () => resolve(finalText.trim());
    recognition.start();
  });
}

async function listenWithServer() {
  recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorderChunks = [];
  recorder = new MediaRecorder(recorderStream);
  recorder.ondataavailable = (event) => {
    if (event.data.size) {
      recorderChunks.push(event.data);
    }
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();
  addTranscript('user', 'Listening…', true);
  await stopped;
  recorderStream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
  const response = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Speech-to-text failed');
  }
  return payload.text;
}

async function startCall() {
  if (listening) {
    stopListening();
    return;
  }
  if (busy) {
    return;
  }

  paintCall(true);
  setStatus('Listening…');
  try {
    const text =
      config.stt.mode === 'server' ? await listenWithServer() : await listenWithBrowser();
    paintCall(false);
    if (text) {
      await ask(text);
    } else {
      setStatus('No speech captured. Type the request instead.');
    }
  } catch (error) {
    paintCall(false);
    if (error.message === 'unsupported' || error.name === 'NotAllowedError') {
      setStatus('Microphone speech is unavailable. Type the request instead.');
      utterance.focus();
      return;
    }
    setStatus(`Microphone stopped (${error.message}). Type the request instead.`);
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  ask(utterance.value);
});

for (const button of callButtons) {
  button.addEventListener('click', () => {
    startCall();
  });
}

runSample.addEventListener('click', () => {
  utterance.value = SAMPLE_REQUEST;
  ask(SAMPLE_REQUEST);
});

loadDesk().catch((error) => {
  setStatus(error.message);
});
