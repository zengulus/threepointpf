# 3.PF character sheet

A deterministic Pathfinder/3.PF web sheet with character-global advancement, N-track progression, inspectable calculations, custom content, and shared browser/Tabletop Simulator roll plans. Rules semantics live in `rules-core`; imported and authored content is injected by callers.

## ▶️ [Live demo](https://zengulus.github.io/threepointpf/)

**[https://zengulus.github.io/threepointpf/](https://zengulus.github.io/threepointpf/)** — no install, no sign-in, no database. It opens on a level 1 fighter and rolls with 3D dice.

## Try the demo

The sheet is published as a static demo on GitHub Pages at **[zengulus.github.io/threepointpf](https://zengulus.github.io/threepointpf/)** (`.github/workflows/pages.yml`), and **demo mode is the default presentation**: it needs no server, no sign-in and no configuration. The published build sets `VITE_DEMO_MODE=true` explicitly, so a credential that happens to exist in the build environment can never turn it into a database client.

Opening it lands on a **level 1 fighter sample** — elite array, Power Attack and Weapon Focus with a greatsword, Toughness, a chain shirt, one level of the fighter progression — and a second sample holds the multi-level showcase sheet. Everything is authored state: the engine recomputes every number, saves stay in that browser's storage, and switching samples is a fresh start.

The same sheet can be used full-page or in a draggable, resizable window over a neutral workspace placeholder. Those are two presentations of one character sheet, not a VTT: maps, tokens, tabletop state, and multiplayer tools are intentionally out of scope. The UI remains a client-only static artifact, so it can still be opened directly from the GitHub Pages `/threepointpf/` subpath.

```bash
corepack pnpm build:demo   # static demo build, relative base path for Pages
corepack pnpm dev          # local development, also in demo mode
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to leave demo mode; anything else stays in it.

### Publishing the demo

`.github/workflows/pages.yml` builds and deploys the site on every push to `main`. It needs one repository setting, which is not a file and so cannot be committed — **this is the only manual step**:

> **Settings → Pages → Build and deployment → Source → GitHub Actions**

A repository can have Pages enabled and still not publish this workflow: a branch-based Pages site looks healthy while serving something else entirely. So the workflow checks the deployment source before it uploads anything, and until the setting above is applied it stops there with that same instruction. Once it is applied, the next push to `main` publishes the demo, and it is served from the project subpath `/threepointpf/` — including the dice textures and sounds, which resolve against that base path rather than the site root.

## Run and verify

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm build:demo
corepack pnpm check:demo      # serves the demo from /threepointpf/ and fetches its assets
corepack pnpm rules:check-autosheet
corepack pnpm check:edge
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm dev
```

CI runs installation, unit/integration tests, build, generated-data freshness, Deno checks, and Chromium smoke tests. Browser tests use the production build, so build first.

## Use the sheet

- Start advancement, choose classes by name, and add levels or track columns. One track, gestalt and N-stalt use the same structure. A class may appear only once in a character-level row, but can move between tracks over its career.
- Open **Author a local class** to create any named class or copy an imported one. Supply its HD, BAB/saves, class skills, skill points, optional explicit cumulative chart, and level-gated features/effects. Local definitions are saved with the character; imported definitions are not overwritten.
- Class skills derive from all classes actually advanced. Ranks trigger the +3 bonus once. Each skill also has an explicit class-skill override for homebrew/manual use.
- Set abilities, HP state, size and five movement modes. Add catalog conditions, armor/shields/weapons, or structured custom effects/items. Inspect combat values, abilities, damage, movement, skills and class levels for their dependency/source trails.
- Start from a sample character (the panel at the top of the sheet). Samples are ordinary authored state, so every derived number is recomputed; **Reset sample** reloads the pristine version, and the browser remembers which sample you were on. Invalid edits retain the last valid character and show an error.
- Open **Workspace** to put that same sheet in a draggable/resizable window, or return to the full-page sheet at any time. The active tab, workspace mode, window visibility/minimized state, and window geometry are temporary UI state; they do not change or save the character.
- Optionally select an XP track. XP reports eligibility; advancing classes remains an explicit edit. Age-category adjustments are optional catalog features, not inferred from a character's race.
- **Save character** persists the sheet across reloads: to Supabase in cloud mode, and to this browser's storage in demo mode. Invalid edits retain the last valid character and show an error.

## Autosheet ingestion

The supplied `INGEST THIS - Pathfinder Autosheet (v6.2.1).xlsx` is development input, never a runtime spreadsheet engine. Generated data contains:

| Content | Imported |
| --- | ---: |
| Progressions, including third-party/FFd20 content | 259 |
| Scoped class-skill sets | 257 |
| Explicit bounded prestige charts | 89 |
| Skill definitions | 42 |
| Armor/shield chassis | 45 |
| Ability-based attack profiles | 60 |
| XP tracks | 3 |
| Age-category ability adjustments | 5 |

```bash
corepack pnpm rules:import-autosheet
corepack pnpm rules:check-autosheet
```

The importer reads cached workbook values, validates against the current schema before writing, and produces deterministic TypeScript plus a SHA-256/source-inventory report. Formula strings are never executed. Quick toggles/conditions and a small PRD weapon/magic-item supplement are reviewed ordinary data in `packages/rules-data/src/content.ts`.

See [Autosheet coverage and next frontier](docs/AUTOSHEET.md) and the [generated import report](packages/rules-data/src/generated/autosheet-import-report.json) for exact normalization, source gaps and unsupported semantics. This is a working core-sheet adaptation, not complete spellcasting/feat automation or literal cell-for-cell parity.

## Rules and persistence contract

Progression level is character-global; each increment is credited to the track occupying that slot. BAB and each save select the best **complete-track total**, not a sum of per-row winners. HD counts one die per slot, using the best die type there. `combat.bab` is a first-class derived fact consumed once by attacks, CMB and CMD. Explicit chart limits are enforced rather than extrapolated.

Catalog IDs distinguish sources (`pf1e.paizo.fighter`, third-party namespaces, `ffd20.autosheet.*`, `homebrew.local.*`). Historic `fighter`/`wizard`/`rogue` aliases are normalized at persistence/evaluation boundaries, including duplicate detection. Query `progression.<canonical-id>.level` or `experience.level` through the engine; neither is an authorable effect target.

Numeric order: replace the intrinsic baseline → typed additive stacking → multipliers → strongest minimum → strongest maximum. Operations contribute deltas with source evidence. Conflicting replacements/bounds and non-finite results fail explicitly. Catalog effects and custom effects use the same pipeline.

Only authored `CharacterInput` is persisted. Local storage uses `threepointpf.character.<id>`. A host can supply a concrete character ID to the app; without one, the standalone sheet retains its sample-picker behavior. Dice appearance and selected sample have their own browser-scoped keys (`threepointpf.dice.presentation` and `threepointpf.sheet.sample`) and never enter character state. Workspace mode, active tab, and floating-window state are deliberately not persisted at all. In demo mode a browser that refuses storage (private browsing, hardened settings) falls back to an in-memory repository so the sheet still works, just without surviving a reload. Supabase saves the complete canonical snapshot in one `characters.authored_state` upsert, alongside legacy scalar projections; old child tables are read-only fallback for pre-snapshot saves. Derived facts/catalog caches are never saved.

For Supabase, supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with an authenticated client session, apply migrations, and deploy `character-state`, `roll-plan`, and `resolve-roll`. The snapshot migration is included, not applied to any hosted database by this change. Never place a service-role key in the browser.

## Tabletop Simulator (deferred)

**Do this later.** The TTS client is gated off: it is frozen at its MVP scope (saves, one attack member with a standard/full choice, maneuvers, a single physical d20) and new roll families are not wired into it. Its script and tests are kept only so that surface cannot silently rot; see the TTS gate in `docs/open-decisions.md`.

Copy `tts/src/global.lua` and its embedded UI into a TTS global script; configure the function URL, a non-privileged bearer token and character ID. Select an authoritative attack ID and zero-based sequence index. TTS sends physical die faces to `/resolve-roll`; the server reloads authored state and recomputes the plan, ignoring client-supplied modifiers. Browser and Edge use the same injected catalogs and roll-plan code.
