import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserDiceProvider,
  formatModifier,
  formatRollOutcome,
  resolveRollPlan,
} from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import {
  attackFromProfile,
  attackProfileCatalog,
  equipmentCatalog,
  experienceCatalog,
  featureCatalog,
  rulesCatalogs,
} from "@threepointpf/rules-data";
import {
  parseCharacterInput,
  type AbilityId,
  type AdvancementSlot,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type DefenseContext,
  type Effect,
  type EffectTargetId,
  type EquipmentInstance,
  type EvaluationResult,
  type FeatureInstance,
  type ProgressionDefinition,
} from "@threepointpf/rules-schema";
import {
  catalogValues,
  clone,
  errorText,
  nextId,
  slug,
} from "../lib/format";
import { activeCatalog, repository } from "../lib/repository";
import { demoCharacter } from "../lib/demo-character";

export function useCharacterSheet() {
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
      // The natural face and the semantic outcome are reported separately, so a
      // threat outside the automatic rule is never shown as a hit. A plan with
      // no comparison of its own (damage, initiative) reports its total only.
      setNotice(
        label +
          ": " +
          raw.faces.join(", ") +
          " " +
          formatModifier(result.modifier) +
          " = " +
          result.total +
          (value.outcomePolicy.kind === "plain"
            ? ""
            : " · " + formatRollOutcome(result.outcome)),
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
  return {
    character,
    catalog,
    derived,
    engine,
    evaluated,
    notice,
    error,
    validationError: error ?? evaluated.error,
    selected,
    inspect,
    update,
    fail,
    updateAbility,
    updateAdvancement,
    toggleFeature,
    addCatalogFeature,
    addManualFeature,
    addAttack,
    addEquipment,
    addCustomWeapon,
    addCustomClass,
    roll,
    save,
    reload,
    featureOptions,
    equipmentOptions,
    profileOptions,
    catalogFeatureId,
    setCatalogFeatureId,
    featureName,
    setFeatureName,
    featureKind,
    setFeatureKind,
    featureTarget,
    setFeatureTarget,
    featureValue,
    setFeatureValue,
    featureBonus,
    setFeatureBonus,
    featureGrant,
    setFeatureGrant,
    featureContexts,
    setFeatureContexts,
    attackName,
    setAttackName,
    attackDice,
    setAttackDice,
    attackAbility,
    setAttackAbility,
    equipmentId,
    setEquipmentId,
    customWeaponName,
    setCustomWeaponName,
    customWeaponDice,
    setCustomWeaponDice,
    weaponEnhancement,
    setWeaponEnhancement,
    weaponAttackAdjustment,
    setWeaponAttackAdjustment,
    weaponStrengthRating,
    setWeaponStrengthRating,
    profileId,
    setProfileId,
  } as const;
}

export type CharacterSheet = ReturnType<typeof useCharacterSheet>;
