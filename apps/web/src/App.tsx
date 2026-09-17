import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserDiceProvider,
  formatModifier,
  resolveRollPlan,
} from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import {
  attackFromProfile,
  attackProfileCatalog,
  equipmentCatalog,
  experienceCatalog,
  featureCatalog,
  progressionCatalog,
  rulesCatalogs,
  skillCatalog,
} from "@threepointpf/rules-data";
import {
  movementModes,
  parseCharacterInput,
  sizeCategories,
  targetLabels,
  type AbilityId,
  type AdvancementSlot,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type Contribution,
  type DefenseContext,
  type DerivedProgressionFeature,
  type Effect,
  type EffectTargetId,
  type EquipmentInstance,
  type EvaluationResult,
  type FeatureInstance,
  type ProgressionCatalog,
  type ProgressionChartLevel,
  type ProgressionDefinition,
  type ProgressionFeatureDefinition,
  type SaveId,
} from "@threepointpf/rules-schema";
import {
  LocalStorageCharacterRepository,
  SupabaseCharacterRepository,
  type CharacterRepository,
} from "@threepointpf/shared";
import { createClient } from "@supabase/supabase-js";

const demoCharacter: CharacterInput = {
  id: "human-martial",
  campaignId: "demo-campaign",
  name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 },
  baseHpBeforeConstitution: 50,
  hitDiceCount: 1,
  damageTaken: 5,
  temporaryHp: 0,
  baseLandSpeed: 30,
  baseSpeeds: { land: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
  baseSize: "medium",
  skillRanks: { acrobatics: 2, perception: 3, intimidate: 0 },
  skills: {
    acrobatics: { governingAbility: "dex", classSkillOverride: true },
    perception: { governingAbility: "wis" },
  },
  attacks: [
    {
      id: "greatsword",
      name: "Greatsword",
      attackAbility: "str",
      damageAbility: "str",
      damageAbilityMultiplier: 1.5,
      baseDamage: { count: 2, sides: 6 },
      attackTags: ["weapon.melee", "weapon.two-handed"],
      mode: "melee",
    },
  ],
  equipment: [],
  features: [
    {
      id: "weapon-focus",
      name: "Weapon Focus",
      description: "A focused martial attack.",
      enabled: true,
      effects: [
        {
          kind: "modifier",
          target: "attack.melee",
          value: 1,
          bonusType: "untyped",
        },
      ],
    },
    {
      id: "heroism",
      definitionId: "pf1e.paizo.heroism",
      name: "Heroism",
      enabled: true,
      effects: [],
    },
    {
      id: "rage",
      name: "Rage",
      description: "A combat toggle affecting the whole dependency graph.",
      enabled: false,
      effects: [
        {
          kind: "modifier",
          target: "ability.str",
          value: 4,
          bonusType: "morale",
        },
        {
          kind: "modifier",
          target: "ability.con",
          value: 4,
          bonusType: "morale",
        },
        {
          kind: "modifier",
          target: "ac",
          value: -2,
          bonusType: "untyped",
          appliesTo: ["normal", "touch", "flatFooted"],
        },
      ],
    },
  ],
};

const abilities: AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];
const abilityLabels: Record<AbilityId, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};
const bonusTypes: BonusType[] = [
  "untyped",
  "dodge",
  "circumstance",
  "armor",
  "shield",
  "naturalArmor",
  "enhancement",
  "deflection",
  "resistance",
  "competence",
  "insight",
  "luck",
  "morale",
  "sacred",
  "profane",
  "size",
  "racial",
  "alchemical",
  "penalty",
];
const effectTargets: EffectTargetId[] = [
  "combat.bab",
  "attack.melee",
  "damage.melee",
  "attack.ranged",
  "damage.ranged",
  "ac",
  "ac.natural",
  "initiative",
  "cmb",
  "cmd",
  "hp",
  "casterLevel",
  "size.relative",
  "save.fortitude",
  "save.reflex",
  "save.will",
  "ability.str",
  "ability.dex",
  "ability.con",
  "ability.int",
  "ability.wis",
  "ability.cha",
  "speed.land",
  "speed.fly",
  "speed.swim",
  "speed.climb",
  "speed.burrow",
  "skill.all",
  "attacks.extra.melee",
  "attacks.extra.ranged",
  ...Object.keys(skillCatalog).map((id): EffectTargetId => `skill.${id}`),
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unexpected validation error.";
}
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function sourceLabel(
  source:
    | { document: string; sheet: string; row?: number; range?: string }
    | undefined,
): string {
  if (!source) return "Local authored content";
  return (
    source.document +
    " · " +
    source.sheet +
    (source.range ? " " + source.range : source.row ? " row " + source.row : "")
  );
}
function nextId(prefix: string, ids: string[]): string {
  let index = 1;
  while (ids.includes(prefix + "-" + index)) index += 1;
  return prefix + "-" + index;
}
function labelFor(target: EffectTargetId): string {
  return (
    targetLabels[target] ??
    (target.startsWith("skill.")
      ? skillCatalog[target.slice(6)]?.name
      : undefined) ??
    target
  );
}
function catalogValues<T extends { id: string; name: string }>(
  catalog: Record<string, T>,
): T[] {
  return Object.values(catalog).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
function activeCatalog(character: CharacterInput): ProgressionCatalog {
  return { ...progressionCatalog, ...(character.customProgressions ?? {}) };
}
function repository(): CharacterRepository {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key)
    return new SupabaseCharacterRepository(
      createClient(url, key),
      rulesCatalogs,
    );
  return new LocalStorageCharacterRepository(rulesCatalogs);
}

function StatCard({
  label,
  value,
  evaluation,
  inspect,
  testId,
}: {
  label: string;
  value: string | number;
  evaluation: EvaluationResult;
  inspect: () => void;
  testId: string;
}) {
  return (
    <button
      className="stat-card"
      data-testid={testId}
      onClick={inspect}
      title="Show calculation breakdown"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>inspect →</small>
    </button>
  );
}
function ContributionTree({
  contribution,
  depth = 0,
}: {
  contribution: Contribution;
  depth?: number;
}) {
  return (
    <>
      <div className="contribution" style={{ marginLeft: depth * 12 }}>
        <span className="contribution-value">
          {formatModifier(contribution.value)}
        </span>
        <span>
          <b>{contribution.label}</b>
          <em>
            {contribution.note ?? contribution.bonusType ?? "base / derived"}
          </em>
          {contribution.sourceMetadata && (
            <em>{sourceLabel(contribution.sourceMetadata)}</em>
          )}
        </span>
      </div>
      {contribution.children?.map((child, index) => (
        <ContributionTree
          key={child.source + "-" + index}
          contribution={child}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
function Breakdown({
  selected,
}: {
  selected: { label: string; evaluation: EvaluationResult } | null;
}) {
  if (!selected)
    return (
      <div className="breakdown empty">
        <span className="eyebrow">AUDIT TRAIL</span>
        <p>Select a calculated value to see its sources.</p>
      </div>
    );
  return (
    <div className="breakdown">
      <div className="eyebrow">AUDIT TRAIL</div>
      <h3>
        {selected.label} <span>= {selected.evaluation.value}</span>
      </h3>
      <div className="contributions">
        {selected.evaluation.contributions.map((item, index) => (
          <ContributionTree
            key={item.source + "-" + index}
            contribution={item}
          />
        ))}
      </div>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function AdvancementEditor({
  slots,
  catalog,
  change,
  fail,
}: {
  slots?: AdvancementSlot[];
  catalog: ProgressionCatalog;
  change: (slots: AdvancementSlot[]) => void;
  fail: (message: string) => void;
}) {
  const definitions = catalogValues(catalog);
  const first =
    definitions.find((definition) => definition.id === "pf1e.paizo.fighter")
      ?.id ?? definitions[0]?.id;
  if (!slots?.length)
    return (
      <section className="panel advancement-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ADVANCEMENT</span>
            <h2>Ordered progression tracks</h2>
          </div>
          <span className="helper">N-track / no gestalt flag</span>
        </div>
        <p className="advancement-copy">
          A class level is character-global while each BAB/save increment
          remains credited to the track that occupied that slot.
        </p>
        <button
          className="button quiet"
          data-testid="advancement-start"
          disabled={!first}
          onClick={() =>
            first &&
            change([
              {
                id: "level-1",
                tracks: [{ id: "track-1", entry: { progressionId: first } }],
              },
            ])
          }
        >
          {first ? "Start advancement" : "No progression definitions available"}
        </button>
      </section>
    );
  const trackIds = slots[0]?.tracks.map((track) => track.id) ?? [];
  const select = (slotId: string, trackId: string, progressionId: string) => {
    const slot = slots.find((item) => item.id === slotId);
    if (
      slot?.tracks.some(
        (track) =>
          track.id !== trackId && track.entry.progressionId === progressionId,
      )
    ) {
      fail(
        "A class may only occupy one track in the same character-level slot.",
      );
      return;
    }
    change(
      slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              tracks: slot.tracks.map((track) =>
                track.id === trackId
                  ? { ...track, entry: { progressionId } }
                  : track,
              ),
            }
          : slot,
      ),
    );
  };
  const addLevel = () => {
    const previous = slots[slots.length - 1]!;
    change([
      ...slots,
      {
        id: nextId(
          "level",
          slots.map((slot) => slot.id),
        ),
        tracks: previous.tracks.map((track) => ({
          id: track.id,
          entry: { progressionId: track.entry.progressionId },
        })),
      },
    ]);
  };
  const addTrack = () => {
    if (definitions.length <= trackIds.length) {
      fail(
        "This row already uses every available progression. Add a custom class or use fewer tracks.",
      );
      return;
    }
    const id = nextId("track", trackIds);
    change(
      slots.map((slot) => {
        const used = new Set(
          slot.tracks.map((track) => track.entry.progressionId),
        );
        const available = definitions.find(
          (definition) => !used.has(definition.id),
        );
        return available
          ? {
              ...slot,
              tracks: [
                ...slot.tracks,
                { id, entry: { progressionId: available.id } },
              ],
            }
          : slot;
      }),
    );
  };
  return (
    <section className="panel advancement-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ADVANCEMENT</span>
          <h2>Ordered progression tracks</h2>
        </div>
        <span className="helper">
          {slots.length} levels · {trackIds.length} tracks
        </span>
      </div>
      <p className="advancement-copy">
        Choices are validated before they are applied. A disabled option is
        already used by another track in that same row.
      </p>
      <div className="advancement-grid-wrap">
        <table className="advancement-grid">
          <thead>
            <tr>
              <th>Level</th>
              {trackIds.map((trackId, index) => (
                <th key={trackId}>
                  Track {index + 1}
                  <button
                    className="table-action"
                    aria-label={"Remove track " + (index + 1)}
                    disabled={trackIds.length === 1}
                    onClick={() =>
                      trackIds.length > 1 &&
                      change(
                        slots.map((slot) => ({
                          ...slot,
                          tracks: slot.tracks.filter(
                            (track) => track.id !== trackId,
                          ),
                        })),
                      )
                    }
                  >
                    ×
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, row) => (
              <tr key={slot.id}>
                <th>Level {row + 1}</th>
                {slot.tracks.map((track, column) => {
                  const used = new Set(
                    slot.tracks
                      .filter((item) => item.id !== track.id)
                      .map((item) => item.entry.progressionId),
                  );
                  return (
                    <td key={track.id}>
                      <select
                        aria-label={
                          "Level " +
                          (row + 1) +
                          " track " +
                          (column + 1) +
                          " progression"
                        }
                        value={track.entry.progressionId}
                        onChange={(event) =>
                          select(slot.id, track.id, event.target.value)
                        }
                      >
                        {definitions.map((definition) => (
                          <option
                            key={definition.id}
                            value={definition.id}
                            disabled={used.has(definition.id)}
                          >
                            {definition.name} ·{" "}
                            {definition.source?.category ?? "Custom"}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="advancement-actions">
        <button
          className="button quiet"
          data-testid="advancement-add-level"
          onClick={addLevel}
        >
          + Level
        </button>
        <button
          className="button quiet"
          data-testid="advancement-remove-level"
          disabled={slots.length === 1}
          onClick={() => slots.length > 1 && change(slots.slice(0, -1))}
        >
          − Last level
        </button>
        <button
          className="button quiet"
          data-testid="advancement-add-track"
          onClick={addTrack}
        >
          + Track
        </button>
      </div>
    </section>
  );
}

function AdvancementSummary({
  levels,
  features,
  catalog,
  inspect,
}: {
  levels: Record<string, EvaluationResult>;
  features: DerivedProgressionFeature[];
  catalog: ProgressionCatalog;
  inspect: (label: string, result: EvaluationResult) => void;
}) {
  if (!Object.keys(levels).length) return null;
  return (
    <section className="panel advancement-summary">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DERIVED ADVANCEMENT</span>
          <h2>Global progression levels</h2>
        </div>
        <span className="helper">Click for provenance</span>
      </div>
      <div className="progression-levels">
        {Object.entries(levels).map(([id, result]) => {
          const definition = catalog[id];
          const name = definition?.name ?? id;
          return (
            <button
              className="progression-level"
              data-testid={"progression-level-" + id}
              key={id}
              onClick={() => inspect(name + " level", result)}
            >
              <span>{name}</span>
              <strong>Level {result.value}</strong>
              <small>{sourceLabel(definition?.source)} · inspect →</small>
            </button>
          );
        })}
      </div>
      {features.length > 0 && (
        <div className="progression-features">
          <span className="eyebrow">UNLOCKED CLASS / SUBCLASS NOTES</span>
          {features.map((feature) => (
            <div
              key={
                feature.progressionId +
                "-" +
                feature.id +
                "-" +
                feature.slotId +
                "-" +
                feature.trackId
              }
            >
              <b>{feature.name}</b>
              <small>
                {feature.description ??
                  feature.progressionId + " level " + feature.level}{" "}
                · {feature.trackId}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function describeEffect(effect: Effect): string {
  if (effect.kind === "modifier")
    return (
      (effect.value >= 0 ? "+" : "") +
      effect.value +
      " " +
      effect.bonusType +
      " → " +
      labelFor(effect.target)
    );
  if (effect.kind === "replaceBase")
    return "replace baseline → " + labelFor(effect.target);
  if (effect.kind === "multiply")
    return "×" + effect.factor + " → " + labelFor(effect.target);
  if (effect.kind === "minimum")
    return "minimum " + effect.value + " → " + labelFor(effect.target);
  if (effect.kind === "maximum")
    return "maximum " + effect.value + " → " + labelFor(effect.target);
  return "grant " + effect.grant + " → " + labelFor(effect.target);
}

function CustomClassEditor({
  catalog,
  add,
  fail,
}: {
  catalog: ProgressionCatalog;
  add: (definition: ProgressionDefinition) => boolean;
  fail: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [idSuffix, setIdSuffix] = useState("");
  const [hitDie, setHitDie] = useState("8");
  const [bab, setBab] =
    useState<ProgressionDefinition["babProgression"]>("threeQuarters");
  const [fort, setFort] =
    useState<ProgressionDefinition["saveProgressions"]["fortitude"]>("poor");
  const [ref, setRef] =
    useState<ProgressionDefinition["saveProgressions"]["reflex"]>("poor");
  const [will, setWill] =
    useState<ProgressionDefinition["saveProgressions"]["will"]>("poor");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillPoints, setSkillPoints] = useState("2");
  const [featureName, setFeatureName] = useState("");
  const [featureLevel, setFeatureLevel] = useState("1");
  const [featureNotes, setFeatureNotes] = useState("");
  const [classEffectTarget, setClassEffectTarget] = useState<
    EffectTargetId | ""
  >("");
  const [classEffectValue, setClassEffectValue] = useState("1");
  const [classEffectBonus, setClassEffectBonus] =
    useState<BonusType>("untyped");
  const [features, setFeatures] = useState<ProgressionFeatureDefinition[]>([]);
  const [chart, setChart] = useState<ProgressionChartLevel[]>([]);
  const [editingId, setEditingId] = useState("");
  const customId = "homebrew.local." + slug(idSuffix || name);
  const classSkills = catalogValues(skillCatalog);
  const loadDefinition = (id: string) => {
    const definition = catalog[id];
    if (!definition) return;
    const own = definition.source?.document === "Local campaign content";
    setEditingId(own ? id : "");
    setName(definition.name + (own ? "" : " custom"));
    setIdSuffix(
      own
        ? id.slice("homebrew.local.".length)
        : slug(definition.name) + "-custom",
    );
    setHitDie(String(definition.hitDieSides));
    setBab(definition.babProgression);
    setFort(definition.saveProgressions.fortitude);
    setRef(definition.saveProgressions.reflex);
    setWill(definition.saveProgressions.will);
    setSkillPoints(String(definition.skillPointsPerLevel ?? 0));
    setSkills([...(definition.classSkills ?? [])]);
    setFeatures(clone(definition.features ?? []));
    setChart(clone(definition.chart ?? []));
  };
  const addFeature = () => {
    const level = Number(featureLevel);
    const id = slug(featureName);
    if (!featureName.trim() || !id || !Number.isInteger(level) || level < 1) {
      fail(
        "Class feature metadata requires a name and a positive whole level.",
      );
      return;
    }
    const effect: Effect | undefined = !classEffectTarget
      ? undefined
      : classEffectTarget === "ac"
        ? {
            kind: "modifier",
            target: "ac",
            value: Number(classEffectValue),
            bonusType: classEffectBonus,
            appliesTo: ["normal", "touch", "flatFooted"],
          }
        : {
            kind: "modifier",
            target: classEffectTarget,
            value: Number(classEffectValue),
            bonusType: classEffectBonus,
          };
    setFeatures((current) => [
      ...current,
      {
        id: nextId(
          id,
          current.map((feature) => feature.id),
        ),
        name: featureName.trim(),
        level,
        ...(featureNotes.trim() ? { description: featureNotes.trim() } : {}),
        ...(effect ? { effects: [effect] } : {}),
      },
    ]);
    setFeatureName("");
    setFeatureNotes("");
  };
  const updateRow = (
    index: number,
    field: "level" | "bab" | SaveId,
    raw: string,
  ) =>
    setChart((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const value = Math.max(0, Math.floor(Number(raw) || 0));
        if (field === "level") return { ...row, level: Math.max(1, value) };
        if (field === "bab") return { ...row, bab: value };
        return { ...row, saves: { ...row.saves, [field]: value } };
      }),
    );
  const submit = () => {
    const suffix = slug(idSuffix || name);
    if (
      !name.trim() ||
      !suffix ||
      !/^homebrew\.local\.[a-z0-9][a-z0-9-]*$/.test(customId)
    ) {
      fail(
        "A custom class needs a name and an id like homebrew.local.my-class.",
      );
      return;
    }
    if (catalog[customId] && customId !== editingId) {
      fail("That custom class id already exists.");
      return;
    }
    const saved = add({
      id: customId,
      name: name.trim(),
      hitDieSides: Math.max(1, Number(hitDie) || 0),
      babProgression: bab,
      saveProgressions: { fortitude: fort, reflex: ref, will },
      skillPointsPerLevel: Math.max(0, Number(skillPoints) || 0),
      ...(skills.length ? { classSkills: skills } : {}),
      ...(features.length ? { features } : {}),
      ...(chart.length ? { chart } : {}),
      source: {
        document: "Local campaign content",
        sheet: "Web class editor",
        category: "Homebrew",
      },
    });
    if (saved) {
      setName("");
      setIdSuffix("");
      setSkills([]);
      setFeatures([]);
      setChart([]);
      setEditingId("");
    }
  };
  return (
    <details className="panel custom-content-panel">
      <summary>
        <span>
          <span className="eyebrow">CUSTOM CONTENT</span>
          <b>Author a local class</b>
        </span>
        <small>{customId}</small>
      </summary>
      <p className="advancement-copy">
        This definition is saved with the character. Features can grant
        explicitly authored effects at their global class level. Names and notes
        do not imply additional rules.
      </p>
      <label className="field">
        <span>Copy an imported class or edit a local class</span>
        <select
          aria-label="Class template or existing local class"
          value=""
          onChange={(event) => loadDefinition(event.target.value)}
        >
          <option value="">Choose a class…</option>
          {catalogValues(catalog).map((definition) => (
            <option value={definition.id} key={definition.id}>
              {definition.name} · {definition.source?.category ?? "Custom"}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <Field label="Class name" type="text" value={name} onChange={setName} />
        <Field
          label="Slug / id suffix"
          type="text"
          value={idSuffix}
          onChange={setIdSuffix}
        />
        <label className="field">
          <span>Hit die</span>
          <input
            aria-label="Custom class hit die"
            type="number"
            min="1"
            step="1"
            value={hitDie}
            onChange={(event) => setHitDie(event.target.value)}
          />
        </label>
        <label className="field">
          <span>BAB chassis</span>
          <select
            aria-label="Custom class BAB progression"
            value={bab}
            onChange={(event) => setBab(event.target.value as typeof bab)}
          >
            <option value="full">Full</option>
            <option value="threeQuarters">Three quarters</option>
            <option value="half">Half</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
        <Field
          label="Skill points / level"
          value={skillPoints}
          onChange={setSkillPoints}
        />
      </div>
      <div className="form-grid save-chassis">
        {(
          [
            ["Fortitude", fort, setFort],
            ["Reflex", ref, setRef],
            ["Will", will, setWill],
          ] as const
        ).map(([label, value, set]) => (
          <label className="field" key={label}>
            <span>{label}</span>
            <select
              value={value}
              onChange={(event) => set(event.target.value as typeof value)}
            >
              <option value="good">Good</option>
              <option value="poor">Poor</option>
              <option value="prestigeGood">Prestige good</option>
              <option value="prestigePoor">Prestige poor</option>
            </select>
          </label>
        ))}
      </div>
      <div className="editor-subsection">
        <span className="eyebrow">CLASS SKILLS</span>
        <div className="check-grid">
          {classSkills.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={skills.includes(item.id)}
                onChange={() =>
                  setSkills((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
              />{" "}
              {item.name}
            </label>
          ))}
        </div>
      </div>
      <div className="editor-subsection">
        <span className="eyebrow">CLASS FEATURE / SUBCLASS NOTE</span>
        <div className="compact-form">
          <input
            aria-label="Custom class feature name"
            placeholder="Feature name"
            value={featureName}
            onChange={(event) => setFeatureName(event.target.value)}
          />
          <input
            aria-label="Custom class feature level"
            type="number"
            min="1"
            value={featureLevel}
            onChange={(event) => setFeatureLevel(event.target.value)}
          />
          <button className="button quiet" type="button" onClick={addFeature}>
            + Feature
          </button>
        </div>
        <div className="compact-form">
          <select
            aria-label="Class feature effect target"
            value={classEffectTarget}
            onChange={(event) =>
              setClassEffectTarget(event.target.value as EffectTargetId | "")
            }
          >
            <option value="">Note only (no numeric effect)</option>
            {effectTargets.map((target) => (
              <option key={target} value={target}>
                {labelFor(target)}
              </option>
            ))}
          </select>
          {classEffectTarget && (
            <>
              <input
                aria-label="Class feature effect value"
                type="number"
                value={classEffectValue}
                onChange={(event) => setClassEffectValue(event.target.value)}
              />
              <select
                aria-label="Class feature bonus type"
                value={classEffectBonus}
                onChange={(event) =>
                  setClassEffectBonus(event.target.value as BonusType)
                }
              >
                {bonusTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <input
          className="full-input"
          aria-label="Custom class feature notes"
          placeholder="Optional feature or subclass note"
          value={featureNotes}
          onChange={(event) => setFeatureNotes(event.target.value)}
        />
        {features.length > 0 && (
          <div className="chip-list">
            {features.map((feature, index) => (
              <span className="chip" key={feature.id}>
                {feature.name} · L{feature.level}
                <button
                  aria-label={"Remove " + feature.name}
                  onClick={() =>
                    setFeatures((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="editor-subsection">
        <div className="subsection-heading">
          <span className="eyebrow">EXPLICIT CUMULATIVE CHART</span>
          <button
            className="button quiet"
            type="button"
            onClick={() =>
              setChart((current) => [
                ...current,
                {
                  level: current.length + 1,
                  bab: 0,
                  saves: { fortitude: 0, reflex: 0, will: 0 },
                },
              ])
            }
          >
            + Chart row
          </button>
        </div>
        <p className="muted">
          Optional rows must be contiguous, non-decreasing cumulative values.
          They override generic chassis values for their levels.
        </p>
        {chart.map((row, index) => (
          <div className="chart-row" key={index}>
            <input
              aria-label={"Chart row " + (index + 1) + " level"}
              type="number"
              min="1"
              value={row.level}
              onChange={(event) =>
                updateRow(index, "level", event.target.value)
              }
            />
            <input
              aria-label={"Chart row " + (index + 1) + " BAB"}
              type="number"
              min="0"
              value={row.bab}
              onChange={(event) => updateRow(index, "bab", event.target.value)}
            />
            {(["fortitude", "reflex", "will"] as SaveId[]).map((save) => (
              <input
                key={save}
                aria-label={"Chart row " + (index + 1) + " " + save}
                type="number"
                min="0"
                value={row.saves[save]}
                onChange={(event) => updateRow(index, save, event.target.value)}
              />
            ))}
            <button
              className="table-action"
              aria-label={"Remove chart row " + (index + 1)}
              onClick={() =>
                setChart((current) =>
                  current.filter((_, rowIndex) => rowIndex !== index),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="button primary"
        data-testid="custom-class-save"
        type="button"
        onClick={submit}
      >
        {editingId ? "Update custom class" : "Add custom class"}
      </button>
    </details>
  );
}

function CustomEquipmentEditor({
  add,
}: {
  add: (item: Omit<EquipmentInstance, "id">) => boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"armor" | "shield" | "other">("armor");
  const [value, setValue] = useState("1");
  const [bonusType, setBonusType] = useState<BonusType>("enhancement");
  const [target, setTarget] = useState<EffectTargetId>("speed.land");
  const [maxDex, setMaxDex] = useState("");
  const [checkPenalty, setCheckPenalty] = useState("0");
  const [slow, setSlow] = useState(false);
  const submit = () => {
    if (!name.trim()) return;
    const effect: Effect =
      kind !== "other"
        ? {
            kind: "modifier",
            target: "ac",
            value: Number(value),
            bonusType: kind,
            appliesTo: ["normal", "flatFooted"],
          }
        : target === "ac"
          ? {
              kind: "modifier",
              target: "ac",
              value: Number(value),
              bonusType,
              appliesTo: ["normal", "touch", "flatFooted"],
            }
          : { kind: "modifier", target, value: Number(value), bonusType };
    if (
      add({
        name: name.trim(),
        equipped: true,
        effects: [effect],
        ...(kind !== "other"
          ? {
              armorCheckPenalty: Number(checkPenalty),
              reduceLandSpeed: slow,
              ...(maxDex.trim() ? { maxDexterity: Number(maxDex) } : {}),
            }
          : {}),
      })
    )
      setName("");
  };
  return (
    <details className="editor-subsection">
      <summary>Custom armor, shield or magic item</summary>
      <div className="form-grid">
        <Field
          label="Custom item name"
          type="text"
          value={name}
          onChange={setName}
        />
        <label className="field">
          <span>Item type</span>
          <select
            aria-label="Custom item type"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="armor">Armor</option>
            <option value="shield">Shield</option>
            <option value="other">Other / magic item</option>
          </select>
        </label>
        <Field label="Item bonus" value={value} onChange={setValue} />
        {kind === "other" ? (
          <>
            <select
              aria-label="Custom item target"
              value={target}
              onChange={(event) =>
                setTarget(event.target.value as EffectTargetId)
              }
            >
              {effectTargets.map((target) => (
                <option key={target} value={target}>
                  {labelFor(target)}
                </option>
              ))}
            </select>
            <select
              aria-label="Custom item bonus type"
              value={bonusType}
              onChange={(event) =>
                setBonusType(event.target.value as BonusType)
              }
            >
              {bonusTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <Field
              label="Maximum Dexterity (blank = no limit)"
              value={maxDex}
              onChange={setMaxDex}
            />
            <Field
              label="Armor check penalty"
              value={checkPenalty}
              onChange={setCheckPenalty}
            />
            <label>
              <input
                type="checkbox"
                checked={slow}
                onChange={(event) => setSlow(event.target.checked)}
              />{" "}
              Reduce land speed for armor
            </label>
          </>
        )}
      </div>
      <button className="button quiet" onClick={submit} disabled={!name.trim()}>
        + Custom item
      </button>
    </details>
  );
}

export function App() {
  const [character, setCharacter] = useState<CharacterInput>(() =>
    clone(demoCharacter),
  );
  const [notice, setNotice] = useState("Local draft ready");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    label: string;
    evaluation: EvaluationResult;
  } | null>(null);
  const [catalogFeatureId, setCatalogFeatureId] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [featureKind, setFeatureKind] = useState<Effect["kind"]>("modifier");
  const [featureTarget, setFeatureTarget] =
    useState<EffectTargetId>("attack.melee");
  const [featureValue, setFeatureValue] = useState("1");
  const [featureBonus, setFeatureBonus] = useState<BonusType>("untyped");
  const [featureGrant, setFeatureGrant] = useState("");
  const [featureContexts, setFeatureContexts] = useState<
    "all" | "normal" | "normalTouch" | "normalFlat"
  >("all");
  const [attackName, setAttackName] = useState("");
  const [attackDice, setAttackDice] = useState("1d8");
  const [attackAbility, setAttackAbility] = useState<AbilityId>("str");
  const [equipmentId, setEquipmentId] = useState("");
  const [customWeaponName, setCustomWeaponName] = useState("");
  const [customWeaponDice, setCustomWeaponDice] = useState("1d6");
  const [weaponEnhancement, setWeaponEnhancement] = useState("0");
  const [weaponAttackAdjustment, setWeaponAttackAdjustment] = useState("0");
  const [weaponStrengthRating, setWeaponStrengthRating] = useState("");
  const [profileId, setProfileId] = useState("");
  const [repo] = useState(repository);
  const editRevision = useRef(0);
  useEffect(() => {
    let active = true;
    void repo
      .load(demoCharacter.id)
      .then((saved) => {
        if (!active || !saved || editRevision.current !== 0) return;
        new RulesEngine(saved, rulesCatalogs).derive();
        setCharacter(saved);
        setNotice("Saved character loaded");
      })
      .catch((failure) => {
        if (active) setError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, [repo]);
  const catalog = useMemo(
    () => activeCatalog(character),
    [character.customProgressions],
  );
  const evaluated = useMemo(() => {
    try {
      const engine = new RulesEngine(character, rulesCatalogs);
      return { engine, derived: engine.derive(), error: null as string | null };
    } catch (failure) {
      const engine = new RulesEngine(demoCharacter, rulesCatalogs);
      return { engine, derived: engine.derive(), error: errorText(failure) };
    }
  }, [character]);
  const engine = evaluated.engine;
  const derived = evaluated.derived;

  const apply = (next: CharacterInput, success?: string) => {
    try {
      parseCharacterInput(next);
      new RulesEngine(next, rulesCatalogs).derive();
      editRevision.current += 1;
      setCharacter(next);
      setSelected(null);
      setError(null);
      if (success) setNotice(success);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      setNotice("Change not applied");
      return false;
    }
  };
  const update = (changes: Partial<CharacterInput>, success?: string) =>
    apply({ ...character, ...changes }, success);
  const fail = (message: string) => {
    setError(message);
    setNotice("Change not applied");
  };
  const inspect = (label: string, evaluation: EvaluationResult) =>
    setSelected({ label, evaluation });
  const featureOptions = catalogValues(featureCatalog);
  const equipmentOptions = catalogValues(equipmentCatalog);
  const profileOptions = catalogValues(attackProfileCatalog);

  const updateAbility = (id: AbilityId, value: string) =>
    update({
      baseAbilities: { ...character.baseAbilities, [id]: Number(value) || 0 },
    });
  const updateAdvancement = (slots: AdvancementSlot[]) =>
    update({
      advancementSlots: slots,
      baseBab: undefined,
      baseSaves: undefined,
      hitDiceCount: undefined,
    });
  const groupFor = (feature: FeatureInstance) =>
    feature.effects.length
      ? undefined
      : featureCatalog[feature.definitionId ?? ""]?.exclusiveGroup;
  const toggleFeature = (id: string) => {
    const selected = character.features.find((feature) => feature.id === id);
    const group =
      selected && !selected.enabled ? groupFor(selected) : undefined;
    update({
      features: character.features.map((feature) =>
        feature.id === id
          ? { ...feature, enabled: !feature.enabled }
          : group && groupFor(feature) === group
            ? { ...feature, enabled: false }
            : feature,
      ),
    });
  };
  const addCatalogFeature = () => {
    const definition = featureCatalog[catalogFeatureId];
    if (!definition) {
      fail("Choose a feature or condition from the catalog.");
      return;
    }
    if (
      character.features.some(
        (feature) => feature.definitionId === definition.id,
      )
    ) {
      fail(
        "That feature is already on this character. Use its toggle to activate it.",
      );
      return;
    }
    const feature: FeatureInstance = {
      id: nextId(
        "feature-" + slug(definition.name),
        character.features.map((item) => item.id),
      ),
      definitionId: definition.id,
      name: definition.name,
      ...(definition.description
        ? { description: definition.description }
        : {}),
      enabled: true,
      effects: [],
    };
    update(
      {
        features: [
          ...character.features.map((entry) =>
            definition.exclusiveGroup &&
            groupFor(entry) === definition.exclusiveGroup
              ? { ...entry, enabled: false }
              : entry,
          ),
          feature,
        ],
      },
      "Added " + definition.name,
    );
    setCatalogFeatureId("");
  };
  const addManualFeature = () => {
    if (!featureName.trim()) {
      fail("A manual feature needs a name.");
      return;
    }
    const value = Number(featureValue);
    if (featureKind !== "grant" && !Number.isFinite(value)) {
      fail("Use a finite numeric effect value.");
      return;
    }
    if (featureKind === "grant" && !featureGrant.trim()) {
      fail("A grant effect needs a capability label.");
      return;
    }
    const contexts: DefenseContext[] =
      featureContexts === "all"
        ? ["normal", "touch", "flatFooted"]
        : featureContexts === "normal"
          ? ["normal"]
          : featureContexts === "normalFlat"
            ? ["normal", "flatFooted"]
            : ["normal", "touch"];
    let effect: Effect;
    if (featureKind === "modifier")
      effect =
        featureTarget === "ac"
          ? {
              kind: "modifier",
              target: "ac",
              value,
              bonusType: featureBonus,
              appliesTo: contexts,
            }
          : {
              kind: "modifier",
              target: featureTarget,
              value,
              bonusType: featureBonus,
            };
    else if (featureKind === "replaceBase")
      effect = { kind: "replaceBase", target: featureTarget, value };
    else if (featureKind === "multiply")
      effect = { kind: "multiply", target: featureTarget, factor: value };
    else if (featureKind === "minimum")
      effect = { kind: "minimum", target: featureTarget, value };
    else if (featureKind === "maximum")
      effect = { kind: "maximum", target: featureTarget, value };
    else
      effect = {
        kind: "grant",
        target: featureTarget,
        grant: featureGrant.trim(),
      };
    const feature: FeatureInstance = {
      id: nextId(
        "custom-feature",
        character.features.map((item) => item.id),
      ),
      name: featureName.trim(),
      enabled: true,
      effects: [effect],
    };
    const added = update(
      { features: [...character.features, feature] },
      "Added " + feature.name,
    );
    if (added) {
      setFeatureName("");
      setFeatureGrant("");
    }
  };
  const addAttack = () => {
    const dice = /^(\d+)d(\d+)$/i.exec(attackDice.trim());
    if (!attackName.trim() || !dice) {
      fail("Use an attack name and dice in the form 1d8.");
      return;
    }
    const attack: AttackDefinition = {
      id: nextId(
        "attack",
        character.attacks.map((item) => item.id),
      ),
      name: attackName.trim(),
      attackAbility,
      damageAbility: attackAbility,
      damageAbilityMultiplier: 1,
      baseDamage: { count: Number(dice[1]), sides: Number(dice[2]) },
      mode: "melee",
      attackTags: ["weapon.melee"],
    };
    if (
      update(
        { attacks: [...character.attacks, attack] },
        "Added " + attack.name,
      )
    )
      setAttackName("");
  };
  const addEquipment = () => {
    const definition = equipmentCatalog[equipmentId];
    if (!definition) {
      fail("Choose equipment from the catalog.");
      return;
    }
    const item: EquipmentInstance = {
      id: nextId(
        "equipment-" + slug(definition.name),
        (character.equipment ?? []).map((entry) => entry.id),
      ),
      definitionId: definition.id,
      name: definition.name,
      equipped: true,
      effects: [],
    };
    const added = update(
      { equipment: [...(character.equipment ?? []), item] },
      "Added " + definition.name,
    );
    if (added) setEquipmentId("");
  };
  const addCustomWeapon = () => {
    const dice = /^(\d+)d(\d+)$/i.exec(customWeaponDice.trim());
    if (!customWeaponName.trim() || !dice) {
      fail("A custom weapon needs a name and dice in the form 1d6.");
      return;
    }
    const id = nextId(
      "equipment-" + slug(customWeaponName),
      (character.equipment ?? []).map((entry) => entry.id),
    );
    const base = {
      id: id + "-attack",
      name: customWeaponName.trim(),
      baseDamage: { count: Number(dice[1]), sides: Number(dice[2]) },
    };
    const attack: AttackDefinition = {
      ...(profileId
        ? attackFromProfile(profileId, base)
        : {
            ...base,
            attackAbility: "str",
            damageAbility: "str",
            damageAbilityMultiplier: 1,
            mode: "melee",
            attackTags: ["weapon.melee"],
          }),
      weaponBonus: Number(weaponEnhancement),
      attackBonus: Number(weaponAttackAdjustment),
      ...(weaponStrengthRating.trim()
        ? { damageAbilityMaximum: Number(weaponStrengthRating) }
        : {}),
    };
    const added = update(
      {
        equipment: [
          ...(character.equipment ?? []),
          {
            id,
            name: customWeaponName.trim(),
            equipped: true,
            effects: [],
            attack,
          },
        ],
      },
      "Added " + customWeaponName.trim(),
    );
    if (added) setCustomWeaponName("");
  };
  const addCustomClass = (definition: ProgressionDefinition) =>
    update(
      {
        customProgressions: {
          ...(character.customProgressions ?? {}),
          [definition.id]: definition,
        },
      },
      "Added " + definition.name,
    );
  const roll = async (
    label: string,
    plan: () => ReturnType<RulesEngine["createSaveRollPlan"]>,
  ) => {
    try {
      const value = plan();
      const raw = await new BrowserDiceProvider().roll({
        planId: value.id,
        dice: value.dice,
      });
      const result = resolveRollPlan(value, raw.faces);
      setNotice(
        label +
          ": " +
          raw.faces.join(", ") +
          " " +
          formatModifier(result.modifier) +
          " = " +
          result.total,
      );
    } catch (failure) {
      setNotice(errorText(failure));
    }
  };
  const save = async () => {
    try {
      await repo.save(character);
      setError(null);
      setNotice(
        import.meta.env.VITE_SUPABASE_URL
          ? "Saved to Supabase"
          : "Saved locally",
      );
    } catch (failure) {
      fail("Save failed: " + errorText(failure));
    }
  };
  const reload = async () => {
    try {
      const loaded = await repo.load(character.id);
      if (!loaded) {
        setNotice("No saved character found");
        return;
      }
      parseCharacterInput(loaded);
      new RulesEngine(loaded, rulesCatalogs).derive();
      setCharacter(loaded);
      setError(null);
      setNotice("Reloaded authored state");
    } catch (failure) {
      fail("Reload failed: " + errorText(failure));
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">3.PF</div>
          <div className="brand-subtitle">character sheet / rules engine</div>
        </div>
        <div className="top-actions">
          <span className="status-dot" />
          {notice}
          <button className="button quiet" onClick={reload}>
            Reload
          </button>
          <button className="button primary" onClick={save}>
            Save character
          </button>
        </div>
      </header>
      {(error || evaluated.error) && (
        <div className="validation-alert" role="alert">
          <b>Authored state was not applied.</b>
          <span>{error ?? evaluated.error}</span>
        </div>
      )}
      <section className="hero">
        <div>
          <span className="eyebrow">PATHFINDER 1E · CHARACTER SHEET</span>
          <input
            className="character-name"
            aria-label="Character name"
            value={character.name}
            onChange={(event) =>
              update({ name: event.target.value || "Unnamed character" })
            }
          />
          <p>
            Select imported content by name, then author only the local facts
            you need. Every edit is validated before it changes the sheet.
          </p>
        </div>
        <div className="hero-meta">
          <span>CAMPAIGN</span>
          <b>{character.campaignId ?? "Unassigned"}</b>
          <span>LEVEL / BAB</span>
          <b>
            {character.advancementSlots
              ? (derived.advancement?.slotCount ?? 0) +
                " / " +
                formatModifier(derived.bab.value)
              : "— / " + formatModifier(derived.bab.value)}
          </b>
        </div>
      </section>
      <div className="layout">
        <div className="main-column">
          <section className="panel inputs-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AUTHORED INPUTS</span>
                <h2>Core numbers, size & movement</h2>
              </div>
              <span className="pill">recompute on edit</span>
            </div>
            <div className="ability-grid">
              {abilities.map((id) => (
                <div className="ability-input" key={id}>
                  <span>{id.toUpperCase()}</span>
                  <input
                    aria-label={abilityLabels[id] + " base score"}
                    type="number"
                    value={character.baseAbilities[id]}
                    onChange={(event) => updateAbility(id, event.target.value)}
                  />
                  <button
                    className="value-link"
                    aria-label={"Inspect " + abilityLabels[id]}
                    onClick={() =>
                      inspect(abilityLabels[id], derived.abilities[id].score)
                    }
                  >
                    {formatModifier(derived.abilities[id].modifier.value)}
                  </button>
                </div>
              ))}
            </div>
            <div className="inline-fields">
              {!character.advancementSlots?.length && (
                <>
                  <Field
                    label="Base BAB"
                    value={character.baseBab ?? ""}
                    onChange={(value) =>
                      update({ baseBab: Number(value) || 0 })
                    }
                  />
                  <Field
                    label="Hit dice"
                    value={character.hitDiceCount ?? ""}
                    onChange={(value) =>
                      update({ hitDiceCount: Math.max(1, Number(value) || 1) })
                    }
                  />
                </>
              )}
              <Field
                label="HP before CON"
                value={character.baseHpBeforeConstitution}
                onChange={(value) =>
                  update({ baseHpBeforeConstitution: Number(value) || 0 })
                }
              />
              <Field
                label="Damage taken"
                value={character.damageTaken}
                onChange={(value) =>
                  update({ damageTaken: Math.max(0, Number(value) || 0) })
                }
              />
              <Field
                label="Temporary HP"
                value={character.temporaryHp}
                onChange={(value) =>
                  update({ temporaryHp: Math.max(0, Number(value) || 0) })
                }
              />
              <label className="field">
                <span>Base size</span>
                <select
                  aria-label="Base size"
                  value={character.baseSize ?? "medium"}
                  onChange={(event) =>
                    update({
                      baseSize: event.target
                        .value as CharacterInput["baseSize"],
                    })
                  }
                >
                  {sizeCategories.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!character.advancementSlots?.length && (
              <div className="save-inputs">
                {(["fortitude", "reflex", "will"] as const).map((save) => (
                  <Field
                    key={save}
                    label={"Base " + save}
                    value={character.baseSaves?.[save] ?? ""}
                    onChange={(value) =>
                      update({
                        baseSaves: {
                          ...(character.baseSaves ?? {
                            fortitude: 0,
                            reflex: 0,
                            will: 0,
                          }),
                          [save]: Number(value) || 0,
                        },
                      })
                    }
                  />
                ))}
              </div>
            )}
            <div className="speed-editor">
              <button
                className="eyebrow value-link"
                onClick={() =>
                  inspect(
                    "Relative size: " + derived.size.category,
                    derived.size.relative,
                  )
                }
              >
                BASE SPEEDS · DERIVED {derived.size.category} (
                {formatModifier(derived.size.relative.value)})
              </button>
              <div className="speed-grid">
                {movementModes.map((mode) => (
                  <label className="field" key={mode}>
                    <span>{mode}</span>
                    <input
                      aria-label={mode + " base speed"}
                      type="number"
                      min="0"
                      value={
                        character.baseSpeeds?.[mode] ??
                        (mode === "land" ? (character.baseLandSpeed ?? 30) : 0)
                      }
                      onChange={(event) => {
                        const value = Math.max(
                          0,
                          Number(event.target.value) || 0,
                        );
                        update({
                          baseSpeeds: {
                            ...character.baseSpeeds,
                            [mode]: value,
                          },
                          ...(mode === "land" ? { baseLandSpeed: value } : {}),
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="derived-speed value-link"
                      data-testid={"speed-" + mode}
                      onClick={(event) => {
                        event.preventDefault();
                        inspect(mode + " speed", derived.speeds[mode]);
                      }}
                    >
                      {derived.speeds[mode].value} ft · inspect
                    </button>
                  </label>
                ))}
              </div>
            </div>
          </section>
          <AdvancementEditor
            slots={character.advancementSlots}
            catalog={catalog}
            change={updateAdvancement}
            fail={fail}
          />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">EXPERIENCE</span>
                <h2>XP & level eligibility</h2>
              </div>
              <span className="helper">
                Optional · does not change class slots
              </span>
            </div>
            <div className="inline-fields">
              <label className="field">
                <span>Experience track</span>
                <select
                  aria-label="Experience track"
                  value={character.experience?.trackId ?? ""}
                  onChange={(event) =>
                    update({
                      experience: event.target.value
                        ? {
                            points: character.experience?.points ?? 0,
                            trackId: event.target.value,
                          }
                        : undefined,
                    })
                  }
                >
                  <option value="">Milestones / no XP tracking</option>
                  {Object.values(experienceCatalog).map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              </label>
              {character.experience && (
                <Field
                  label="Experience points"
                  value={character.experience.points}
                  onChange={(value) =>
                    update({
                      experience: {
                        ...character.experience!,
                        points: Number(value),
                      },
                    })
                  }
                />
              )}
              {derived.experience && (
                <button
                  className="value-link"
                  data-testid="experience-level"
                  onClick={() =>
                    inspect(
                      "XP level eligibility",
                      derived.experience!.eligibleLevel,
                    )
                  }
                >
                  Eligible level {derived.experience.eligibleLevel.value} ·{" "}
                  {derived.experience.remaining !== undefined
                    ? derived.experience.remaining + " XP to next level"
                    : "End of imported chart"}{" "}
                  · inspect
                </button>
              )}
            </div>
          </section>
          {derived.advancement && (
            <AdvancementSummary
              levels={derived.advancement.progressionLevels}
              features={derived.advancement.features}
              catalog={catalog}
              inspect={inspect}
            />
          )}
          <CustomClassEditor
            catalog={catalog}
            add={addCustomClass}
            fail={fail}
          />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">DERIVED SHEET</span>
                <h2>Defenses & combat</h2>
              </div>
              <span className="helper">Click any value to inspect</span>
            </div>
            <div className="stats-grid">
              <StatCard
                label="Base Attack Bonus"
                value={formatModifier(derived.bab.value)}
                evaluation={derived.bab}
                inspect={() => inspect("Base Attack Bonus", derived.bab)}
                testId="stat-bab"
              />
              <StatCard
                label="Armor Class"
                value={derived.ac.value}
                evaluation={derived.ac}
                inspect={() => inspect("Armor Class", derived.ac)}
                testId="stat-ac"
              />
              <StatCard
                label="Touch AC"
                value={derived.touchAc.value}
                evaluation={derived.touchAc}
                inspect={() => inspect("Touch AC", derived.touchAc)}
                testId="stat-touch-ac"
              />
              <StatCard
                label="Flat-footed"
                value={derived.flatFootedAc.value}
                evaluation={derived.flatFootedAc}
                inspect={() => inspect("Flat-footed AC", derived.flatFootedAc)}
                testId="stat-flat-footed"
              />
              <StatCard
                label="HP"
                value={derived.currentHp + " / " + derived.maxHp.value}
                evaluation={derived.maxHp}
                inspect={() => inspect("Maximum HP", derived.maxHp)}
                testId="stat-current-hp"
              />
              <StatCard
                label="Max HP"
                value={derived.maxHp.value}
                evaluation={derived.maxHp}
                inspect={() => inspect("Maximum HP", derived.maxHp)}
                testId="stat-max-hp"
              />
              <StatCard
                label="Initiative"
                value={formatModifier(derived.initiative.value)}
                evaluation={derived.initiative}
                inspect={() => inspect("Initiative", derived.initiative)}
                testId="stat-initiative"
              />
              <StatCard
                label="CMB"
                value={formatModifier(derived.cmb.value)}
                evaluation={derived.cmb}
                inspect={() => inspect("CMB", derived.cmb)}
                testId="stat-cmb"
              />
              <StatCard
                label="CMD"
                value={derived.cmd.value}
                evaluation={derived.cmd}
                inspect={() => inspect("CMD", derived.cmd)}
                testId="stat-cmd"
              />
            </div>
            <div className="saves-row">
              {(["fortitude", "reflex", "will"] as const).map((save) => (
                <div className="roll-row" key={save}>
                  <button
                    className="value-link"
                    onClick={() => inspect(save, derived.saves[save])}
                  >
                    <span>{save}</span>
                    <strong>{formatModifier(derived.saves[save].value)}</strong>
                  </button>
                  <button
                    className="roll-button"
                    data-testid={"roll-" + save}
                    onClick={() =>
                      roll(save + " save", () =>
                        engine.createSaveRollPlan(save),
                      )
                    }
                  >
                    ROLL d20
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">ATTACKS</span>
                <h2>Weapons & full attack plans</h2>
              </div>
              <span className="helper">
                Single-weapon sequences · extra attacks once per full attack
              </span>
            </div>
            {derived.attacks.map((attack) => (
              <div
                className="attack-row full-attack-row"
                key={attack.definition.id}
              >
                <button
                  className="value-link attack-name"
                  onClick={() =>
                    inspect(attack.definition.name + " attack", attack.attack)
                  }
                >
                  <span>{attack.definition.name}</span>
                  <strong>{formatModifier(attack.attack.value)}</strong>
                  <small>{attack.damage.formula}</small>
                </button>
                <div className="attack-sequence">
                  <button
                    className="value-link"
                    aria-label={"Inspect " + attack.definition.name + " damage"}
                    onClick={() =>
                      inspect(attack.definition.name + " damage modifier", {
                        target: `damage.${attack.definition.mode ?? "melee"}`,
                        value: attack.damage.modifier,
                        contributions: attack.damage.contributions,
                      })
                    }
                  >
                    Damage · inspect
                  </button>
                  {attack.fullAttack.map((result, index) => (
                    <button
                      key={index}
                      className="roll-button"
                      data-testid={
                        "roll-attack-" +
                        attack.definition.id +
                        (index ? "-" + index : "")
                      }
                      onClick={() =>
                        roll(
                          attack.definition.name + " attack " + (index + 1),
                          () =>
                            engine.createAttackRollPlan(
                              attack.definition.id,
                              index,
                            ),
                        )
                      }
                    >
                      ROLL {formatModifier(result.value)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="add-row">
              <input
                placeholder="Attack name"
                aria-label="New attack name"
                value={attackName}
                onChange={(event) => setAttackName(event.target.value)}
              />
              <input
                placeholder="1d8"
                aria-label="New attack dice"
                value={attackDice}
                onChange={(event) => setAttackDice(event.target.value)}
              />
              <select
                aria-label="New attack ability"
                value={attackAbility}
                onChange={(event) =>
                  setAttackAbility(event.target.value as AbilityId)
                }
              >
                {abilities.map((id) => (
                  <option key={id} value={id}>
                    {id.toUpperCase()}
                  </option>
                ))}
              </select>
              <button className="button quiet" onClick={addAttack}>
                + Add attack
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">SKILLS</span>
                <h2>Catalog skills</h2>
              </div>
              <span className="helper">
                Automatic metadata + optional override
              </span>
            </div>
            <div className="skills-grid">
              {Object.values(derived.skills).map((skill) => {
                const override =
                  character.skills?.[skill.id]?.classSkillOverride ??
                  character.skills?.[skill.id]?.classSkill;
                return (
                  <div className="skill-row" key={skill.id}>
                    <button
                      className="skill-inspect"
                      title={
                        sourceLabel(skillCatalog[skill.id]?.source) +
                        (skillCatalog[skill.id]?.trainedOnly
                          ? " · Trained only"
                          : "")
                      }
                      onClick={() => inspect(skill.label, skill.total)}
                    >
                      <span>{skill.label}</span>
                      <em>
                        {skill.governingAbility.toUpperCase()}
                        {skill.classSkill ? " · class" : ""}
                      </em>
                      <b>{formatModifier(skill.total.value)}</b>
                    </button>
                    <label className="rank-input">
                      <span>ranks</span>
                      <input
                        aria-label={skill.label + " ranks"}
                        type="number"
                        min="0"
                        value={skill.ranks}
                        onChange={(event) =>
                          update({
                            skillRanks: {
                              ...character.skillRanks,
                              [skill.id]: Number(event.target.value) || 0,
                            },
                          })
                        }
                      />
                    </label>
                    <select
                      className="class-skill-override"
                      aria-label={skill.label + " class skill override"}
                      value={
                        override === undefined
                          ? "auto"
                          : override
                            ? "yes"
                            : "no"
                      }
                      onChange={(event) => {
                        const current = character.skills?.[skill.id] ?? {};
                        const {
                          classSkillOverride: removed,
                          classSkill: legacyRemoved,
                          ...rest
                        } = current;
                        update({
                          skills: {
                            ...character.skills,
                            [skill.id]:
                              event.target.value === "auto"
                                ? rest
                                : {
                                    ...rest,
                                    classSkillOverride:
                                      event.target.value === "yes",
                                  },
                          },
                        });
                      }}
                    >
                      <option value="auto">auto</option>
                      <option value="yes">class</option>
                      <option value="no">not class</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel equipment-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">EQUIPMENT</span>
                <h2>Catalog gear & custom weapons</h2>
              </div>
              <span className="helper">
                Equipped effects and attacks derive from authored instances
              </span>
            </div>
            <div className="catalog-add-row">
              <select
                aria-label="Catalog equipment"
                value={equipmentId}
                onChange={(event) => setEquipmentId(event.target.value)}
              >
                <option value="">Choose catalog equipment…</option>
                {equipmentOptions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name} · {definition.kind}
                  </option>
                ))}
              </select>
              <button
                className="button quiet"
                disabled={!equipmentId}
                onClick={addEquipment}
              >
                + Equip selected
              </button>
            </div>
            {equipmentId && (
              <p className="muted">
                {sourceLabel(equipmentCatalog[equipmentId]?.source)}
                {equipmentCatalog[equipmentId]?.description
                  ? " · " + equipmentCatalog[equipmentId]?.description
                  : ""}
              </p>
            )}
            {(character.equipment ?? []).map((item) => (
              <div className="equipment-row" key={item.id}>
                <label>
                  <input
                    aria-label={"Equip " + (item.name ?? item.id)}
                    type="checkbox"
                    checked={item.equipped}
                    onChange={() =>
                      update({
                        equipment: (character.equipment ?? []).map((entry) =>
                          entry.id === item.id
                            ? { ...entry, equipped: !entry.equipped }
                            : entry,
                        ),
                      })
                    }
                  />{" "}
                  <b>
                    {item.name ??
                      equipmentCatalog[item.definitionId ?? ""]?.name ??
                      item.definitionId ??
                      "Unnamed item"}
                  </b>
                </label>
                <small>
                  {item.definitionId
                    ? sourceLabel(equipmentCatalog[item.definitionId]?.source)
                    : item.attack
                      ? "Local custom weapon"
                      : "Local custom equipment"}
                  {item.definitionId &&
                    equipmentCatalog[item.definitionId]?.description && (
                      <span>
                        {" "}
                        · {equipmentCatalog[item.definitionId]?.description}
                      </span>
                    )}
                </small>
                <button
                  className="table-action"
                  aria-label={"Remove " + (item.name ?? item.id)}
                  onClick={() =>
                    update({
                      equipment: (character.equipment ?? []).filter(
                        (entry) => entry.id !== item.id,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="custom-equipment-form">
              <input
                aria-label="Custom equipment name"
                placeholder="Custom weapon name"
                value={customWeaponName}
                onChange={(event) => setCustomWeaponName(event.target.value)}
              />
              <input
                aria-label="Custom equipment dice"
                placeholder="1d6"
                value={customWeaponDice}
                onChange={(event) => setCustomWeaponDice(event.target.value)}
              />
              <select
                aria-label="Custom equipment attack profile"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="">Manual melee profile</option>
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {sourceLabel(profile.source)}
                  </option>
                ))}
              </select>
              <Field
                label="Weapon enhancement"
                value={weaponEnhancement}
                onChange={setWeaponEnhancement}
              />
              <Field
                label="Attack adjustment"
                value={weaponAttackAdjustment}
                onChange={setWeaponAttackAdjustment}
              />
              <Field
                label="Strength damage cap (optional)"
                value={weaponStrengthRating}
                onChange={setWeaponStrengthRating}
              />
              <button className="button quiet" onClick={addCustomWeapon}>
                + Custom weapon
              </button>
            </div>
            {profileId && (
              <p className="muted">
                {attackProfileCatalog[profileId]?.description} · Select only
                profiles your character qualifies for; prerequisites and
                combined two-weapon penalties are not automatic.
              </p>
            )}
            <CustomEquipmentEditor
              add={(item) =>
                update(
                  {
                    equipment: [
                      ...(character.equipment ?? []),
                      {
                        ...item,
                        id: nextId(
                          "custom-item",
                          (character.equipment ?? []).map((entry) => entry.id),
                        ),
                      },
                    ],
                  },
                  "Added " + item.name,
                )
              }
            />
          </section>
        </div>
        <aside className="side-column">
          <Breakdown selected={selected} />
          <section className="panel features-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">FEATURES / CONDITIONS</span>
                <h2>Catalog choices & effects</h2>
              </div>
            </div>
            <div className="catalog-add-row">
              <select
                aria-label="Catalog feature or condition"
                value={catalogFeatureId}
                onChange={(event) => setCatalogFeatureId(event.target.value)}
              >
                <option value="">Choose a feature or condition…</option>
                {featureOptions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name} · {sourceLabel(definition.source)}
                  </option>
                ))}
              </select>
              <button
                className="button quiet"
                disabled={!catalogFeatureId}
                onClick={addCatalogFeature}
              >
                + Add
              </button>
            </div>
            {character.features.map((feature) => (
              <div
                className={"feature-row " + (feature.enabled ? "enabled" : "")}
                key={feature.id}
              >
                <button
                  className="toggle"
                  aria-label={"Toggle " + feature.name}
                  aria-pressed={feature.enabled}
                  onClick={() => toggleFeature(feature.id)}
                >
                  <span />
                </button>
                <div>
                  <b>{feature.name}</b>
                  <small>
                    {feature.definitionId
                      ? (featureCatalog[feature.definitionId]?.description ??
                        feature.name)
                      : feature.effects.map(describeEffect).join(" · ") ||
                        "No authored effects"}
                  </small>
                </div>
                <i>{feature.enabled ? "ON" : "OFF"}</i>
                <button
                  className="table-action"
                  aria-label={"Remove feature " + feature.name}
                  onClick={() =>
                    update({
                      features: character.features.filter(
                        (item) => item.id !== feature.id,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="feature-form">
              <input
                placeholder="Feature name"
                aria-label="New feature name"
                value={featureName}
                onChange={(event) => setFeatureName(event.target.value)}
              />
              <select
                aria-label="New feature kind"
                value={featureKind}
                onChange={(event) =>
                  setFeatureKind(event.target.value as Effect["kind"])
                }
              >
                <option value="modifier">Modifier</option>
                <option value="replaceBase">Replace intrinsic baseline</option>
                <option value="multiply">Multiply result</option>
                <option value="minimum">Minimum result</option>
                <option value="maximum">Maximum result</option>
                <option value="grant">Grant capability</option>
              </select>
              <select
                aria-label="New feature target"
                value={featureTarget}
                onChange={(event) =>
                  setFeatureTarget(event.target.value as EffectTargetId)
                }
              >
                {effectTargets.map((target) => (
                  <option key={target} value={target}>
                    {labelFor(target)}
                  </option>
                ))}
              </select>
              {featureKind === "grant" ? (
                <input
                  aria-label="New feature grant"
                  placeholder="Granted capability"
                  value={featureGrant}
                  onChange={(event) => setFeatureGrant(event.target.value)}
                />
              ) : (
                <div className="mini-fields">
                  <input
                    aria-label="New feature value"
                    type="number"
                    step={featureKind === "multiply" ? "0.1" : "1"}
                    value={featureValue}
                    onChange={(event) => setFeatureValue(event.target.value)}
                  />
                  {featureKind === "modifier" && (
                    <select
                      aria-label="New feature bonus type"
                      value={featureBonus}
                      onChange={(event) =>
                        setFeatureBonus(event.target.value as BonusType)
                      }
                    >
                      {bonusTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {featureKind === "modifier" && featureTarget === "ac" && (
                <select
                  aria-label="New feature AC applicability (required)"
                  value={featureContexts}
                  onChange={(event) =>
                    setFeatureContexts(
                      event.target.value as typeof featureContexts,
                    )
                  }
                >
                  <option value="all">AC: all contexts</option>
                  <option value="normal">AC: normal only</option>
                  <option value="normalTouch">AC: normal + touch</option>
                  <option value="normalFlat">
                    AC: normal + flat-footed (armor / shield)
                  </option>
                </select>
              )}
              <button className="button quiet" onClick={addManualFeature}>
                + Add structured effect
              </button>
            </div>
          </section>
          {derived.grants.length > 0 && (
            <section className="panel">
              <span className="eyebrow">
                ACTIVE CAPABILITIES / RESTRICTIONS
              </span>
              <p className="muted">
                These reminders are not automatically enforced by the roll
                engine.
              </p>
              {derived.grants.map((grant, index) => (
                <p key={grant.source.id + index}>
                  <b>{grant.grant.replaceAll("-", " ")}</b>
                  <small> · {grant.source.label}</small>
                </p>
              ))}
            </section>
          )}
          <div className="side-note">
            <span className="eyebrow">SOURCE OF TRUTH</span>
            <p>
              Only authored state and local class content are persisted. The
              catalog stays injected, and every displayed fact or roll plan is
              derived again from that state.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
