import {
  activeDiceSkin,
  customDiceSkinId,
  diceFlourishes,
  diceMaterialOptions,
  diceSkinPresets,
  diceSurfaceOptions,
  diceTextureOptions,
  type DicePresentationSettings,
  type DiceSkin,
} from "@threepointpf/dice";
import type { DicePresentation } from "../hooks/useDicePresentation";

/** The five selectable presentation slots, in the order a table thinks about them. */
const flourishSlots = [
  {
    key: "criticalSuccess",
    label: "Critical success (attacks & saves)",
    testId: "dice-flourish-critical-success",
  },
  {
    key: "criticalFailure",
    label: "Critical failure (attacks & saves)",
    testId: "dice-flourish-critical-failure",
  },
  {
    key: "natural20",
    label: "Natural 20 (other rolls)",
    testId: "dice-flourish-natural-20",
  },
  {
    key: "natural1",
    label: "Natural 1 (other rolls)",
    testId: "dice-flourish-natural-1",
  },
  {
    key: "ordinary",
    label: "Ordinary rolls",
    testId: "dice-flourish-ordinary",
  },
] as const;

function ColorField({
  label,
  value,
  testId,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="field dice-color">
      <span>{label}</span>
      <input
        type="color"
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <code>{value}</code>
    </label>
  );
}

/**
 * Dice appearance settings: skins (colours, texture, material, surface),
 * flourishes per presentation slot, sound, intensity and reduced motion. These
 * are user display preferences, so they persist under their own key and never
 * enter authored character state.
 */
export function DiceSettingsPanel({ dice }: { dice: DicePresentation }) {
  const { settings, updateSettings, resetSettings } = dice;
  const skin = activeDiceSkin(settings);
  const custom = settings.skinId === customDiceSkinId;

  /**
   * Editing any appearance axis switches the skin to Custom, seeded with what is
   * currently on screen, so the edit never jumps to a different look.
   */
  const editSkin = (patch: Partial<DiceSkin>) =>
    updateSettings({
      skinId: customDiceSkinId,
      customSkin: { ...skin, ...patch },
    });

  const setFlourish = (
    slot: keyof DicePresentationSettings["flourishes"],
    id: string,
  ) => updateSettings({ flourishes: { ...settings.flourishes, [slot]: id } });

  return (
    <section className="panel dice-settings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DICE PRESENTATION</span>
          <h2>Dice &amp; flourishes</h2>
        </div>
        <button
          className="button quiet"
          data-testid="dice-settings-reset"
          onClick={resetSettings}
        >
          Reset
        </button>
      </div>
      <p className="muted">
        Presentation only. Rolls are resolved from authored state first; the 3D
        dice then land on those faces, so physics can never change a result.
      </p>
      <div className="dice-settings-grid">
        <label className="field">
          <span>Skin</span>
          <select
            data-testid="dice-skin"
            value={settings.skinId}
            onChange={(event) =>
              updateSettings({ skinId: event.target.value })
            }
          >
            {diceSkinPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value={customDiceSkinId}>Custom…</option>
          </select>
        </label>
        <label className="field">
          <span>Texture</span>
          <select
            data-testid="dice-texture"
            value={skin.texture}
            onChange={(event) => editSkin({ texture: event.target.value })}
          >
            {diceTextureOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Material</span>
          <select
            data-testid="dice-material"
            value={skin.material}
            onChange={(event) => editSkin({ material: event.target.value })}
          >
            {diceMaterialOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Table surface</span>
          <select
            data-testid="dice-surface"
            value={skin.surface}
            onChange={(event) => editSkin({ surface: event.target.value })}
          >
            {diceSurfaceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dice-colors">
        <ColorField
          label="Numerals"
          value={skin.foreground}
          testId="dice-color-foreground"
          disabled={!custom}
          onChange={(foreground) => editSkin({ foreground })}
        />
        <ColorField
          label="Body"
          value={skin.background}
          testId="dice-color-background"
          disabled={!custom}
          onChange={(background) => editSkin({ background })}
        />
        <ColorField
          label="Outline"
          value={skin.outline}
          testId="dice-color-outline"
          disabled={!custom}
          onChange={(outline) => editSkin({ outline })}
        />
        <ColorField
          label="Edge"
          value={skin.edge ?? skin.foreground}
          testId="dice-color-edge"
          disabled={!custom}
          onChange={(edge) => editSkin({ edge })}
        />
      </div>
      <p className="muted">
        Picking a colour, texture, material or surface switches the skin to
        Custom; a preset keeps its authored look.
      </p>
      <div className="dice-settings-grid">
        {flourishSlots.map((slot) => (
          <label className="field" key={slot.key}>
            <span>{slot.label}</span>
            <select
              data-testid={slot.testId}
              value={settings.flourishes[slot.key]}
              onChange={(event) => setFlourish(slot.key, event.target.value)}
            >
              {diceFlourishes.map((flourish) => (
                <option key={flourish.id} value={flourish.id}>
                  {flourish.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="dice-toggles">
        <label className="checkbox-field">
          <input
            type="checkbox"
            data-testid="dice-sound"
            checked={settings.sound}
            onChange={(event) =>
              updateSettings({ sound: event.target.checked })
            }
          />
          <span>Sounds</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            data-testid="dice-reduced-motion"
            checked={settings.reducedMotion}
            onChange={(event) =>
              updateSettings({ reducedMotion: event.target.checked })
            }
          />
          <span>Reduced motion (no animated throw)</span>
        </label>
        <label className="field dice-intensity">
          <span>Intensity</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            data-testid="dice-intensity"
            value={settings.intensity}
            onChange={(event) =>
              updateSettings({ intensity: Number(event.target.value) })
            }
          />
          <code>{settings.intensity}</code>
        </label>
      </div>
    </section>
  );
}
