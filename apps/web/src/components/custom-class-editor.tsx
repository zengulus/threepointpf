import { useState } from "react";
import type {
  BonusType,
  Effect,
  EffectTargetId,
  ProgressionCatalog,
  ProgressionChartLevel,
  ProgressionDefinition,
  ProgressionFeatureDefinition,
  SaveId,
} from "@threepointpf/rules-schema";
import { skillCatalog } from "@threepointpf/rules-data";
import { catalogValues, clone, labelFor, nextId, slug } from "../lib/format";
import { abilities, bonusTypes, effectTargets } from "../lib/options";
import { Field } from "./primitives";

export function CustomClassEditor({
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
