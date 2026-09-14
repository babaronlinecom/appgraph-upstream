# Private repository analysis

AppGraph can analyze a private GitHub repository when `GITHUB_TOKEN` is configured with read access to that repository.

## Security model

- Keep the token server-side only.
- Prefer a fine-grained GitHub token.
- Grant **Contents: Read-only** and **Metadata: Read-only** only.
- Scope the token to the smallest possible repository set.
- Never expose the token to browser code, logs, screenshots, or committed `.env` files.

## BabarOnline canonical target

For BabarOnline architecture analysis, the active source of truth is:

```text
babaronlinecom/babar-online-os
```

The similarly named repository below is legacy and archived and must not be selected for active analysis or implementation:

```text
babaronlinecom/babaronlineOS
```

## Local setup

```bash
cp .env.example .env.local
# set GITHUB_TOKEN to a read-only token that can read babaronlinecom/babar-online-os
npm install
npm run dev
```

Open AppGraph locally and analyze:

```text
https://github.com/babaronlinecom/babar-online-os
```

## CLI

```bash
GITHUB_TOKEN=... npm run analyze -- babaronlinecom/babar-online-os \
  --out graph.json \
  --report architecture.md \
  --mermaid
```

Store generated architecture output separately from the application source. For BabarOnline, the preferred destination is under the existing `agent-ctx/generated/` convention rather than creating a second context system.

## Validation

Run the opt-in private-repository live check:

```bash
APPGRAPH_PRIVATE_LIVE_TEST=1 \
APPGRAPH_PRIVATE_REPO=babaronlinecom/babar-online-os \
GITHUB_TOKEN=... \
npx vitest run tests/manual/live-private-github.test.ts
```

The test is skipped by default and never runs in normal CI without the explicit environment flag.
