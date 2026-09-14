# Private repository analysis

AppGraph can analyze a private GitHub repository when `GITHUB_TOKEN` is configured with read access to that repository.

## Security model

- Keep the token server-side only.
- Prefer a fine-grained GitHub token.
- Grant **Contents: Read-only** and **Metadata: Read-only** only.
- Scope the token to the smallest possible repository set.
- Never expose the token to browser code, logs, screenshots, or committed `.env` files.

## Local setup

```bash
cp .env.example .env.local
# set GITHUB_TOKEN to a read-only token that can read your target private repository
npm install
npm run dev
```

Open AppGraph locally and analyze a repository URL such as:

```text
https://github.com/OWNER/PRIVATE_REPO
```

## CLI

```bash
GITHUB_TOKEN=... npm run analyze -- OWNER/PRIVATE_REPO \
  --out graph.json \
  --report architecture.md \
  --mermaid
```

Store generated architecture output in the target project's own private documentation or artifact storage. Avoid committing private architecture output into a public AppGraph fork.

## Local checkout analysis

If the repository is already available on disk, AppGraph can analyze it without sending repository credentials through the analyzer:

```bash
npm run analyze -- --local /path/to/repository \
  --out graph.json \
  --report architecture.md \
  --mermaid
```

This is useful in CI systems that already check out a private repository using their native authentication.

## Validation

Run the opt-in private-repository live check:

```bash
APPGRAPH_PRIVATE_LIVE_TEST=1 \
APPGRAPH_PRIVATE_REPO=OWNER/PRIVATE_REPO \
GITHUB_TOKEN=... \
npx vitest run tests/manual/live-private-github.test.ts
```

The test is skipped by default and never runs in normal CI without the explicit environment flag.
