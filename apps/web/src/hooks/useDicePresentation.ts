import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeDiceSkin,
  classifyRollPresentation,
  defaultDicePresentationSettings,
  flourishFor,
  hasStoredDicePreferences,
  loadDicePreferences,
  saveDicePreferences,
  systemPrefersReducedMotion,
  updateDicePresentationSettings,
  type DiceFlourish,
  type DicePresentationSettings,
  type DicePresentationSettingsPatch,
  type DicePresenter,
  type ResolvedRoll,
  type RollPresentation,
} from "@threepointpf/dice";
import type { RollPlan } from "@threepointpf/rules-schema";
import { createDiceBoxPresenter } from "../lib/dice-3d";

/** One resolved roll, frozen for presentation. Physics can no longer affect it. */
export interface DiceStage {
  id: number;
  plan: RollPlan;
  resolved: ResolvedRoll;
  presentation: RollPresentation;
  flourish: DiceFlourish;
}

function initialSettings(): DicePresentationSettings {
  const loaded = loadDicePreferences();
  // A first run follows the operating system's motion preference; a saved
  // choice always wins over it.
  if (!hasStoredDicePreferences() && systemPrefersReducedMotion())
    return updateDicePresentationSettings(loaded, { reducedMotion: true });
  return loaded;
}

/**
 * Presentation state for rolls: the user's dice preferences (persisted under
 * their own key, never in character state), the resolved roll currently being
 * shown, and the renderer behind the `DicePresenter` boundary.
 */
export function useDicePresentation() {
  const [settings, setSettings] = useState<DicePresentationSettings>(initialSettings);
  const [stage, setStage] = useState<DiceStage | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageCount = useRef(0);
  const settingsRef = useRef(settings);
  const presenter = useMemo<DicePresenter>(
    () =>
      createDiceBoxPresenter({
        settings: settingsRef.current,
        stage: () => stageRef.current,
      }),
    [],
  );

  useEffect(() => {
    settingsRef.current = settings;
    presenter.configure(settings);
  }, [presenter, settings]);

  useEffect(() => () => presenter.dispose(), [presenter]);

  const updateSettings = useCallback(
    (patch: DicePresentationSettingsPatch) => {
      setSettings((current) => {
        const next = updateDicePresentationSettings(current, patch);
        saveDicePreferences(next);
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    const next: DicePresentationSettings = {
      ...defaultDicePresentationSettings,
      customSkin: { ...defaultDicePresentationSettings.customSkin },
      flourishes: { ...defaultDicePresentationSettings.flourishes },
      reducedMotion: systemPrefersReducedMotion(),
    };
    saveDicePreferences(next);
    setSettings(next);
  }, []);

  /**
   * Shows an already-resolved roll. The faces come from the resolution, never
   * from the renderer: the flourish is chosen from the resolved facts, so no
   * game rule is repeated here.
   */
  const present = useCallback(
    (plan: RollPlan, resolved: ResolvedRoll) => {
      const presentation = classifyRollPresentation(plan, resolved.outcome);
      stageCount.current += 1;
      setStage({
        id: stageCount.current,
        plan,
        resolved,
        presentation,
        flourish: flourishFor(settingsRef.current, presentation.event),
      });
    },
    [],
  );

  const dismiss = useCallback(() => {
    // Closing the overlay also owns the renderer's lifetime. In particular,
    // this cancels a lazy WebGL initialization that may still be awaiting dice
    // assets, rather than letting it attach a canvas after the stage is gone.
    presenter.dispose();
    setStage(null);
  }, [presenter]);

  return {
    settings,
    skin: activeDiceSkin(settings),
    stage,
    presenter,
    stageRef,
    updateSettings,
    resetSettings,
    present,
    dismiss,
  } as const;
}

export type DicePresentation = ReturnType<typeof useDicePresentation>;
