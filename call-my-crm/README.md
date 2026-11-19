# Call My CRM

Voice agent add-on. Setup, the Teams webhook, and screenshots are in [docs/README.md](docs/README.md).

```bash
docker compose up --build
# or, with Node 22+:
node --test test/*.test.mjs
node src/server.mjs
```

Open http://localhost:8787. Copy `.env.example` to `.env` before adding an NVIDIA or Twenty key. Do not commit `.env`.
