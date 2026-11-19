import { createApp } from './create-app.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig(process.env);
const app = createApp({
  config,
  logger: (line) => {
    console.log(line);
  },
});

const server = app.listen(config.port, () => {
  const host = `http://localhost:${config.port}`;
  console.log(`Call My CRM listening on ${host}`);
  console.log(
    `LLM ${config.llm.provider} · CRM ${config.crm.provider} · STT ${config.stt.mode} · TTS ${config.tts.mode}`,
  );
});

server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
