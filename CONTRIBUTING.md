# Contributing

QMReader is primarily maintained for 向阳乔木's reading workflow, but focused contributions are welcome.

## Good Contribution Areas

- RSS source fixes and new source definitions.
- Fetch freshness and background worker reliability.
- Privacy/security boundary improvements.
- Deployment documentation for self-hosted installs.
- Bug fixes with clear reproduction steps.
- UI fixes that preserve the quiet reader-first workflow.

## Before You Open A PR

1. Keep changes scoped. Avoid unrelated refactors.
2. Do not commit `.env`, API keys, SQLite files, cache files, logs, screenshots, or `node_modules`. Runtime DB defaults to `data/qmreader.sqlite` — do not confuse it with historical empty files under `data/`.
3. Run the relevant checks:

```bash
node --check server.js
node --check modules/create-app.js
# spot-check modules, or:
# find modules -name '*.js' -print0 | xargs -0 -n1 node --check
node --check lib/background-jobs.js
node --check lib/fetcher.js
node --check lib/deepseek.js
node --check lib/store.js
node --check lib/sources.js
node --check scripts/refresh-worker.js
npm run check:frontend
npm test
```

Edit frontend sources under `public/src/*`. Before release run `npm run build:frontend`; do not hand-edit `public/app.bundle.min.js`.

4. If the change affects live behavior, describe how you verified it locally or on a test deployment.
5. If the change affects public docs, keep `README.md` Chinese-first and English-accessible.

## Commit And PR Style

- Use concise commit messages.
- Explain user-visible impact first.
- Include screenshots or API output only when they are current and do not contain secrets.
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
