# Security Policy

## Supported Versions

QMReader is maintained from the `main` branch. Public reports should target the latest published code unless a release tag says otherwise.

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities or leaked credentials.

Report security issues privately through the repository owner's preferred contact channel.

Include:

- A short description of the issue.
- Affected route, file, or deployment mode.
- Reproduction steps or a minimal proof of concept.
- Whether any secret, account, or private content may be exposed.

## Secret Handling

- Keep `.env`, `.env.local`, runtime SQLite files, cache files, logs, and screenshots out of Git.
- The repository intentionally ships only `.env.example` with empty key values.
- Server-side fallback provider keys are loaded from environment variables or env files.
- `OWNER_PASSWORD` is required for the fixed owner account and is stored in SQLite only as a scrypt hash. Do not commit it or expose the server's `.env` file.
- User-supplied AI keys are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` and stored in SQLite. API responses expose only a masked hint, never plaintext or the internal credential ID.
- Browsers send only an AI profile ID for provider calls. Back up the SQLite database and encryption key separately; losing the key makes stored AI credentials unrecoverable.
- Comments, chat messages, translations, and rewrites remain private behind owner authentication; still avoid placing credentials in content or prompts.

## Network Boundary

QMReader rejects non-HTTPS AI base URLs and blocks localhost/private network AI base URLs. All reader content requires an HttpOnly owner Session. Terminate TLS at a reverse proxy and keep the application port bound to the local host. This reduces risk but does not replace normal deployment hardening.
