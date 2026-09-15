# 3.PF character sheet

This repository contains the first vertical slice of a Pathfinder 1e / 3.PF character sheet. The rules engine is deterministic and independent of React, Supabase, browsers and Tabletop Simulator.

## Run

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @threepointpf/web dev
```

The web app starts with the integration fixture from `tests/fixtures/simple-character.json` embedded as a local draft. Save/reload uses an in-memory repository when Supabase variables are absent. To use Supabase, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; only the public anon key belongs in the browser. Apply the migration in `supabase/migrations` and deploy the three Edge Functions.

The authored HP fields are `baseHpBeforeConstitution`, `damageTaken`, and `temporaryHp`; legacy manual mode also accepts `hitDiceCount`. The derived `maxHp` adds the effective Constitution modifier once per hit die, and `currentHp` is derived as `maxHp - damageTaken`; temporary HP remains separate. `replaceBase` effects replace intrinsic baselines and competing active replacements are rejected. Generic `ac` modifiers must declare `appliesTo` contexts explicitly. `GrantEffect` is retained for future capabilities and is exposed by the rules engine without affecting current numeric totals.

Advancement mode uses ordered `advancementSlots`, each with any number of named tracks. A one-track character, gestalt, and tristalt are represented by one, two, and three tracks respectively; no gestalt flag is needed. The seeded structural catalog contains only Fighter, Wizard, and Rogue definitions. BAB and each save use the best complete track total, while HD uses one die per slot and the best die type within that slot. Manual BAB/saves/HD remain available when `advancementSlots` is absent; HP-from-HD is intentionally deferred.

Copy `tts/src/global.lua` and its embedded UI into a Tabletop Simulator global script, configure the function URL and a non-privileged bearer token, and bind the desired character id. TTS sends only raw physical die faces back to `/resolve-roll`; the TypeScript side rehydrates the character and recomputes the plan before resolving it.
