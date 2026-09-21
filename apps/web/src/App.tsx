import { formatModifier } from "@threepointpf/dice";
import { useState, type KeyboardEvent, type ReactNode } from "react";
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
import { useCharacterSheet, type CharacterSheet } from "./hooks/useCharacterSheet";

const sheetTabs = [
  { id: "summary", label: "Summary" },
  { id: "attributes", label: "Attributes" },
  { id: "combat", label: "Combat" },
  { id: "inventory", label: "Inventory" },
  { id: "features", label: "Features" },
  { id: "skills", label: "Skills" },
  { id: "advancement", label: "Advancement" },
  { id: "notes", label: "Notes" },
] as const;

type SheetTab = (typeof sheetTabs)[number]["id"];

function TabWorkspace({
  children,
  sheet,
}: {
  children: ReactNode;
  sheet: CharacterSheet;
}) {
  return (
    <div className={"tab-workspace " + (sheet.selected ? "has-inspector" : "")}>
      <div className="tab-main">{children}</div>
      {sheet.selected && (
        <aside className="tab-inspector">
          <Breakdown selected={sheet.selected} />
        </aside>
      )}
    </div>
  );
}

function ActiveCapabilities({ sheet }: { sheet: CharacterSheet }) {
  if (sheet.derived.grants.length === 0) return null;
  return (
    <section className="panel">
      <span className="eyebrow">ACTIVE CAPABILITIES / RESTRICTIONS</span>
      <p className="muted">
        These reminders are not automatically enforced by the roll engine.
      </p>
      {sheet.derived.grants.map((grant, index) => (
        <p key={grant.source.id + index}>
          <b>{grant.grant.replaceAll("-", " ")}</b>
          <small> · {grant.source.label}</small>
        </p>
      ))}
    </section>
  );
}

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
  const [activeTab, setActiveTab] = useState<SheetTab>("summary");

  const selectTab = (tab: SheetTab) => setActiveTab(tab);
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % sheetTabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + sheetTabs.length) % sheetTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = sheetTabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = sheetTabs[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab.id);
    document.getElementById("sheet-tab-" + nextTab.id)?.focus();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">3.PF</div>
          <div className="brand-subtitle">{character.name}</div>
        </div>
        <nav className="chrome-nav" aria-label="Sheet tools">
          <button type="button" onClick={() => selectTab("summary")}>
            ⌘ Sheet
          </button>
          <button type="button" onClick={() => selectTab("attributes")}>
            ▣ Character
          </button>
          <button type="button" onClick={() => selectTab("features")}>
            ✦ Features
          </button>
          <button type="button" onClick={() => selectTab("notes")}>
            ☰ Notes
          </button>
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
      <nav className="sheet-tabs" aria-label="Character sheet sections" role="tablist">
        {sheetTabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              className={selected ? "active" : ""}
              type="button"
              role="tab"
              id={"sheet-tab-" + tab.id}
              aria-selected={selected}
              aria-controls={"sheet-panel-" + tab.id}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              key={tab.id}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      <TabWorkspace sheet={sheet}>
        <section
          className="sheet-tab-panel summary-tab-panel"
          role="tabpanel"
          id="sheet-panel-summary"
          aria-labelledby="sheet-tab-summary"
          tabIndex={0}
          hidden={activeTab !== "summary"}
        >
          <SummarySheet sheet={sheet} onSelectTab={selectTab} />
          <div className="summary-utilities">
            <SamplePanel sheet={sheet} />
            <DiceSettingsPanel dice={sheet.dice} />
          </div>
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-attributes"
          aria-labelledby="sheet-tab-attributes"
          tabIndex={0}
          hidden={activeTab !== "attributes"}
        >
          <InputsPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-combat"
          aria-labelledby="sheet-tab-combat"
          tabIndex={0}
          hidden={activeTab !== "combat"}
        >
          <DefensesPanel sheet={sheet} />
          <AttacksPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-inventory"
          aria-labelledby="sheet-tab-inventory"
          tabIndex={0}
          hidden={activeTab !== "inventory"}
        >
          <EquipmentPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-features"
          aria-labelledby="sheet-tab-features"
          tabIndex={0}
          hidden={activeTab !== "features"}
        >
          <FeaturesPanel sheet={sheet} />
          <ActiveCapabilities sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-skills"
          aria-labelledby="sheet-tab-skills"
          tabIndex={0}
          hidden={activeTab !== "skills"}
        >
          <SkillsPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id="sheet-panel-advancement"
          aria-labelledby="sheet-tab-advancement"
          tabIndex={0}
          hidden={activeTab !== "advancement"}
        >
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
        </section>
        <section
          className="sheet-tab-panel notes-tab-panel"
          role="tabpanel"
          id="sheet-panel-notes"
          aria-labelledby="sheet-tab-notes"
          tabIndex={0}
          hidden={activeTab !== "notes"}
        >
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">NOTES</span>
                <h2>Character record</h2>
              </div>
            </div>
            <div className="side-note">
              <span className="eyebrow">SOURCE OF TRUTH</span>
              <p>
                Only authored state and local class content are persisted. The
                catalog stays injected, and every displayed fact or roll plan is
                derived again from that state.
              </p>
            </div>
          </section>
        </section>
      </TabWorkspace>
      <DiceOverlay dice={sheet.dice} />
    </main>
  );
}
