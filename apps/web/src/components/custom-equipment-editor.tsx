import { useState } from "react";
import type {
  BonusType,
  Effect,
  EffectTargetId,
  EquipmentInstance,
} from "@threepointpf/rules-schema";
import { labelFor } from "../lib/format";
import { bonusTypes, effectTargets } from "../lib/options";
import { Field } from "./primitives";

export function CustomEquipmentEditor({
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
