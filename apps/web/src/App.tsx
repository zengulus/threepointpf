import { formatModifier } from "@threepointpf/dice";
import { AdvancementEditor, AdvancementSummary } from "./components/advancement";
import { CustomClassEditor } from "./components/custom-class-editor";
import { DiceOverlay } from "./components/dice-overlay";
import { DiceSettingsPanel } from "./components/dice-settings";
import { SamplePanel } from "./components/sample-panel";
import { SummarySheet } from "./components/summary-sheet";
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
  const level =
    derived.advancement?.slotCount || character.hitDiceCount || 1;
  const landSpeed = derived.speeds.land.value;
  const featureCount = character.features.filter((feature) => feature.enabled).length;
  const equippedCount = (character.equipment ?? []).filter(
    (item) => item.equipped,
  ).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">3.PF</div>
          <div className="brand-subtitle">{character.name}</div>
        </div>
        <nav className="chrome-nav" aria-label="Sheet tools">
          <a href="#summary">⌘ Sheet</a>
          <a href="#details">▣ Character</a>
          <a href="#features">✦ Features</a>
          <a href="#notes">☰ Notes</a>
        </nav>
        <div className="top-actions">
          <span className="status-dot" />
          <span className="sheet-notice">{sheet.notice}</span>
          <button className="button quiet" onClick={sheet.reload}>
            Reload
          </button>
          <button className="button primary" onClick={sheet.save}>
            Save character
          </button>
        </div>
      </header>
      <section className="hero sheet-identity">
        <div className="character-portrait" aria-hidden="true">
          <span className="portrait-rune">3</span>
          <span className="portrait-caption">PF</span>
          <div className="portrait-token">⚔</div>
        </div>
        <div className="identity-details">
          <input
            className="character-name"
            aria-label="Character name"
            value={character.name}
            onChange={(event) =>
              sheet.update({ name: event.target.value || "Unnamed character" })
            }
          />
          <div className="identity-fields">
            <div>
              <span>Campaign</span>
              <b>{character.campaignId ?? "Unassigned"}</b>
            </div>
            <div>
              <span>Size</span>
              <b>{derived.size.category}</b>
            </div>
            <div>
              <span>Movement</span>
              <b>{landSpeed} ft land</b>
            </div>
            <div>
              <span>Mode</span>
              <b>{sheet.mode === "demo" ? "Local demo" : "Cloud save"}</b>
            </div>
          </div>
          <div className="identity-tags">
            <span>{featureCount} active feature{featureCount === 1 ? "" : "s"}</span>
            <span>{equippedCount} equipped item{equippedCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="hero-meta level-summary">
          <span>Level {level}</span>
          <b>{formatModifier(derived.bab.value)} BAB</b>
          <div className="level-rule" aria-hidden="true">
            <span style={{ width: Math.min(100, Math.max(18, level * 12)) + "%" }} />
          </div>
          <small>
            {character.experience
              ? character.experience.points.toLocaleString() + " XP"
              : "Milestone advancement"}
          </small>
        </div>
      </section>
      {sheet.validationError && (
        <div className="validation-alert" role="alert">
          <b>Authored state was not applied.</b>
          <span>{sheet.validationError}</span>
        </div>
      )}
      <nav className="sheet-tabs" aria-label="Character sheet sections">
        <a className="active" href="#summary">Summary</a>
        <a href="#attributes">Attributes</a>
        <a href="#combat">Combat</a>
        <a href="#inventory">Inventory</a>
        <a href="#features">Features</a>
        <a href="#skills">Skills</a>
        <a href="#advancement">Advancement</a>
        <a href="#notes">Notes</a>
      </nav>
      <SummarySheet sheet={sheet} />
      <div className="detail-divider" id="details">
        <span>Character details &amp; authored state</span>
        <p>Expand the live summary with the underlying rules, catalog choices, and campaign tools.</p>
      </div>
      <div className="layout">
        <div className="main-column">
          <SamplePanel sheet={sheet} />
          <div id="attributes"><InputsPanel sheet={sheet} /></div>
          <div id="advancement"><AdvancementEditor
            slots={character.advancementSlots}
            catalog={sheet.catalog}
            change={sheet.updateAdvancement}
            fail={sheet.fail}
          /></div>
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
          <div id="combat"><DefensesPanel sheet={sheet} /></div>
          <AttacksPanel sheet={sheet} />
          <div id="skills"><SkillsPanel sheet={sheet} /></div>
          <div id="inventory"><EquipmentPanel sheet={sheet} /></div>
        </div>
        <aside className="side-column">
          <Breakdown selected={sheet.selected} />
          <DiceSettingsPanel dice={sheet.dice} />
          <div id="features"><FeaturesPanel sheet={sheet} /></div>
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
          <div className="side-note" id="notes">
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
