# VS Code handoff: Site v307

This branch brings the latest public 3.PF Site features into the GitHub development repository. It starts from `97b402313124634be6bb56ca1686d44ca48e4d48`, the tested head of draft PR #4, so that branch's earlier campaign/character fixes and portable Windows tooling remain included.

The functional source was reconciled against Site v307 (`d5350c912dcacc02fa13a810461aca2fbdaa9664`). GitHub-specific tooling, CI, docs, and stronger tests are retained. This is a development handoff, not a merge or deployment.

## Open in VS Code

For an existing clone, first save or commit your current work, then run:

```sh
git fetch origin
git switch --track origin/handoff/site-v307-play-reference-2026-10-13
code .
```

If the local branch already exists, use `git switch handoff/site-v307-play-reference-2026-10-13` instead. For a fresh clone:

```sh
git clone --branch handoff/site-v307-play-reference-2026-10-13 https://github.com/zengulus/threepointpf.git
cd threepointpf
code .
```

Use Node 22.13 or newer and the package.json-pinned pnpm 12.4.1. Run `corepack pnpm install:ci` for the frozen workspace install. `npm run install:ci` also delegates to pinned pnpm; do not use `npm ci` for this pnpm workspace.

## Included since PR #4

- Play reference → Download play reference: a browser-local text snapshot of current evaluated defenses, health, rolls, labelled damage, skills, resources, and active-effect reminders. It includes unsaved edits and wound penalties, performs no roll, and does not save or upload the character. The file is a manual reference, not an Owlbear import or a JSON backup.
- Recorded roll history: stable cursor pagination, older-page loading, refresh/retry states, and race-safe character changes. Every page rechecks current character access; reading never rolls, spends, or sends to Discord.
- Discord connection status: explicit loading/failure states and retries, preserving draft input and the existing stale-campaign protections.
- Unit/component/API regressions plus desktop/mobile Playwright download/layout checks.

## Verify locally

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm build:demo
corepack pnpm check:demo
corepack pnpm rules:check-autosheet
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm --filter @threepointpf/web build:hosted
corepack pnpm test:e2e:hosted
```

The demo build is browser-only. Hosted mode uses the same-origin API and requires the existing hosting/authentication configuration. No credentials, database contents, runtime state, generated frontend bundles, or deployment changes are included in this handoff. Preserve `.openai/hosting.json` and the existing Site's database/auth/sharing configuration when doing future deployment work. See the draft pull request's current CI results for verification of the exact remote commit.
