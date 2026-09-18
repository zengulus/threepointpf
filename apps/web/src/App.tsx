import { formatModifier } from "@threepointpf/dice";
import { AdvancementEditor, AdvancementSummary } from "./components/advancement";
import { CustomClassEditor } from "./components/custom-class-editor";
import { DiceOverlay } from "./components/dice-overlay";
import { DiceSettingsPanel } from "./components/dice-settings";
import { SamplePanel } from "./components/sample-panel";
import { Breakdown } from "./components/primitives";
import {
  AttacksPanel,
  DefensesPanel,
  EquipmentPanel,
  ExperiencePanel,
  FeaturesPanel,
  InputsPanel,
  SkillsPanel,
} from "./components/panels";
import { useCharacterSheet } from "./hooks/useCharacterSheet";

/**
 * The sheet is composed from domain panels; every rule, derived fact and roll
 * plan comes from the shared `useCharacterSheet` hook, which delegates to
 * rules-core and injects the catalog content.
 */
export function App() {
  const sheet = useCharacterSheet();
  const { character, derived } = sheet;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">3.PF</div>
          <div className="brand-subtitle">character sheet / rules engine</div>
        </div>
        <div className="top-actions">
          <span className="status-dot" />
          {sheet.notice}
          <button className="button quiet" onClick={sheet.reload}>
            Reload
          </button>
          <button className="button primary" onClick={sheet.save}>
            Save character
          </button>
        </div>
      </header>
      {sheet.validationError && (
        <div className="validation-alert" role="alert">
          <b>Authored state was not applied.</b>
          <span>{sheet.validationError}</span>
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
              sheet.update({ name: event.target.value || "Unnamed character" })
            }
          />
          <p>
            Select imported content by name, then author only the local facts
            you need. Every edit is validated before it changes the sheet.
          </p>
          <p className="hero-mode">
            {sheet.mode === "demo"
              ? "Demo mode · no server, no sign-in, edits stay in this browser"
              : "Cloud mode · characters save to this campaign's Supabase project"}
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
          <SamplePanel sheet={sheet} />
          <InputsPanel sheet={sheet} />
          <AdvancementEditor
            slots={character.advancementSlots}
            catalog={sheet.catalog}
            change={sheet.updateAdvancement}
            fail={sheet.fail}
          />
          <ExperiencePanel sheet={sheet} />
          {derived.advancement && (
            <AdvancementSummary
              levels={derived.advancement.progressionLevels}
              features={derived.advancement.features}
              catalog={sheet.catalog}
              inspect={sheet.inspect}
            />
          )}
          <CustomClassEditor
            catalog={sheet.catalog}
            add={sheet.addCustomClass}
            fail={sheet.fail}
          />
          <DefensesPanel sheet={sheet} />
          <AttacksPanel sheet={sheet} />
          <SkillsPanel sheet={sheet} />
          <EquipmentPanel sheet={sheet} />
        </div>
        <aside className="side-column">
          <Breakdown selected={sheet.selected} />
          <DiceSettingsPanel dice={sheet.dice} />
          <FeaturesPanel sheet={sheet} />
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
      <DiceOverlay dice={sheet.dice} />
    </main>
  );
}
