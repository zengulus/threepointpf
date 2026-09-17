# 3.PF character sheet

A deterministic Pathfinder/3.PF web sheet with character-global advancement, N-track progression, inspectable calculations, custom content, and shared browser/Tabletop Simulator roll plans. Rules semantics live in `rules-core`; imported and authored content is injected by callers.

## Run and verify

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
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
- Optionally select an XP track. XP reports eligibility; advancing classes remains an explicit edit. Age-category adjustments are optional catalog features, not inferred from a character's race.
- **Save character** persists a local draft across reloads. Invalid edits retain the last valid character and show an error.

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

Only authored `CharacterInput` is persisted. Local storage uses `threepointpf.character.<id>`. Supabase saves the complete canonical snapshot in one `characters.authored_state` upsert, alongside legacy scalar projections; old child tables are read-only fallback for pre-snapshot saves. Derived facts/catalog caches are never saved.

For Supabase, supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with an authenticated client session, apply migrations, and deploy `character-state`, `roll-plan`, and `resolve-roll`. The snapshot migration is included, not applied to any hosted database by this change. Never place a service-role key in the browser.

## Tabletop Simulator

Copy `tts/src/global.lua` and its embedded UI into a TTS global script; configure the function URL, a non-privileged bearer token and character ID. Select an authoritative attack ID and zero-based sequence index. TTS sends physical die faces to `/resolve-roll`; the server reloads authored state and recomputes the plan, ignoring client-supplied modifiers. Browser and Edge use the same injected catalogs and roll-plan code.
