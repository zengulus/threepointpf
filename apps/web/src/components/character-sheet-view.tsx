import { formatModifier } from "@threepointpf/dice";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AdvancementEditor, AdvancementSummary } from "./advancement";
import { CustomClassEditor } from "./custom-class-editor";
import { DiceSettingsPanel } from "./dice-settings";
import { DiscordSettingsPanel } from "./discord-settings";
import { ThemeSettingsPanel } from "./theme-settings";
import { SamplePanel } from "./sample-panel";
import { SummarySheet } from "./summary-sheet";
import { Breakdown } from "./primitives";
import {
  AttacksPanel,
  DefensesPanel,
  EquipmentPanel,
  ExperiencePanel,
  FeaturesPanel,
  InputsPanel,
  SkillsPanel,
} from "./panels";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import type { ThemePreferenceController } from "../hooks/useThemePreference";
import { characterFilename, copyWithNewCharacterId, exportCharacterSnapshot } from "../lib/character-portability";
import { LifecycleWizard } from "./lifecycle-wizard";
import { hostedDeliveryNotice } from "../lib/hosted-roll";
import { SpellcastingPanel } from "./spellcasting-panel";
import { CharacterNotesPanel } from "./character-record";
import { WorkbookSystemsPanel } from "./workbook-systems-panel";
import { WorkbookGuide } from "./workbook-guide";

const sheetTabs = [
  { id: "summary", label: "Summary" },
  { id: "attributes", label: "Attributes" },
  { id: "combat", label: "Combat" },
  { id: "inventory", label: "Inventory" },
  { id: "features", label: "Features" },
  { id: "spells", label: "Spells" },
  { id: "skills", label: "Skills" },
  { id: "advancement", label: "Advancement" },
  { id: "notes", label: "Notes" },
  { id: "settings", label: "Settings" },
] as const;

export type SheetTab = (typeof sheetTabs)[number]["id"];

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
 * One reusable character-sheet surface. It deliberately receives an already
 * created controller, so surrounding application presentations never fork
 * authored state, rule evaluation, or dice preferences.
 */
export function CharacterSheetView({
  sheet,
  theme,
  activeTab,
  onActiveTabChange,
  onOpenWorkspace,
  playerView = false,
}: {
  sheet: CharacterSheet;
  theme: ThemePreferenceController;
  activeTab: SheetTab;
  onActiveTabChange: (tab: SheetTab) => void;
  onOpenWorkspace?: () => void;
  playerView?: boolean;
}) {
  const { character, derived } = sheet;
  const level = derived.advancement?.slotCount || character.hitDiceCount || 1;
  const landSpeed = derived.speeds.land.value;
  const featureCount = character.features.filter((feature) => feature.enabled).length +
    (character.abilities ?? []).filter((ability) =>
      ability.activation === "passive" ||
      (ability.activation === "toggleable" && ability.active),
    ).length;
  const equippedCount = (character.equipment ?? []).filter(
    (item) => item.equipped,
  ).length;
  const viewId = useId();
  const tabButtons = useRef(new Map<SheetTab, HTMLButtonElement>());
  const importInput = useRef<HTMLInputElement>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [managementNotice, setManagementNotice] = useState<string | null>(null);
  const [pendingCharacterImport, setPendingCharacterImport] = useState<{ contents: string; fileName: string; incomingName: string; existingName: string } | null>(null);
  const [lifecycleMode, setLifecycleMode] = useState<"create" | "level-up" | null>(null);
  const ManagementContainer = playerView ? "details" : "div";
  const exportCurrent = () => {
    setManagementError(null);
    try {
      const filename = characterFilename(character.name);
      const blob = new Blob([exportCharacterSnapshot(character)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setManagementNotice(`Download started: ${filename}`);
    } catch {
      setManagementNotice(null);
      setManagementError("This character could not be exported. Try saving the character and exporting again.");
    }
  };
  const duplicateCurrent = async () => {
    setManagementError(null);
    setManagementNotice(null);
    try {
      if (sheet.isDirty && !(await sheet.save())) {
        setManagementError("Save the current character before duplicating it; newer edits may still be unsaved.");
        return;
      }
      const duplicate = copyWithNewCharacterId({ ...character, name: `${character.name} (Copy)` });
      if (await sheet.commitLifecycleCharacter(duplicate, `Created ${duplicate.name}`)) {
        setManagementNotice(`${duplicate.name} is ready. The original was saved; use Open character to switch between copies.`);
      } else {
        setManagementError("The character copy could not be saved. Check the sheet error and try again.");
      }
    } catch {
      setManagementError("This character could not be copied. Check its authored data and try again.");
    }
  };
  const importCharacterContents = async (contents: string, fileName: string, collisionAction?: "copy" | "replace") => {
    setManagementError(null);
    setManagementNotice(null);
    try {
      const result = await sheet.importSnapshot(contents, collisionAction);
      if (typeof result === "object" && result !== null && result.status === "collision") {
        setPendingCharacterImport({ contents, fileName, incomingName: result.incomingName, existingName: result.existingName });
        return;
      }
      setPendingCharacterImport(null);
      if (result === "cancelled") return;
      if (!result) setManagementError("The character could not be imported. Check the validation error above.");
    } catch {
      setManagementError("This file could not be read. Choose a ThreepointPF .json character export and try again.");
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setManagementError(null);
    setManagementNotice(null);
    try {
      const contents = await file.text();
      let format = "";
      try {
        const envelope: unknown = JSON.parse(contents);
        if (envelope && typeof envelope === "object" && !Array.isArray(envelope) && "format" in envelope && typeof envelope.format === "string") format = envelope.format;
      } catch { /* The character importer gives invalid JSON a useful message. */ }
      if (format === "threepointpf-character-library") {
        const result = await sheet.importLibrarySnapshot(contents);
        if (!result) {
          setManagementError("The library import failed. Check the sheet status for details.");
          return;
        }
        if (result.status === "cancelled") return;
        setManagementNotice(`Imported ${result.count} character${result.count === 1 ? "" : "s"}${result.replaced ? `; ${result.replaced} existing ${result.replaced === 1 ? "character was" : "characters were"} replaced` : ""}${result.copied ? `; ${result.copied} added as copies` : ""}. Use Open character to choose one.`);
        return;
      }
      await importCharacterContents(contents, file.name);
    } catch {
      setManagementNotice(null);
      setManagementError("This file could not be read. Choose a ThreepointPF character or library .json export and try again.");
    }
  };
  const resolveCharacterImport = (action: "copy" | "replace") => {
    if (!pendingCharacterImport) return;
    const pending = pendingCharacterImport;
    setPendingCharacterImport(null);
    void importCharacterContents(pending.contents, pending.fileName, action);
  };
  const exportLibrary = async () => {
    setManagementError(null);
    setManagementNotice(null);
    try {
      const contents = await sheet.exportLibrarySnapshot();
      const filename = `threepointpf-library-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setManagementNotice(`Library backup started: ${filename}`);
    } catch {
      setManagementNotice(null);
      setManagementError("The character library could not be exported. Save characters and try again.");
    }
  };

  const selectTab = (tab: SheetTab) => onActiveTabChange(tab);
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
    tabButtons.current.get(nextTab.id)?.focus();
  };

  return (
    <section className="character-sheet-view" data-testid="character-sheet-view">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">3.PF</div>
          <div className="brand-subtitle">{character.name}</div>
        </div>
        <ManagementContainer className={playerView ? "character-management-actions player-character-actions" : "character-management-actions"}>
          {playerView && <summary>Character actions</summary>}
          {!playerView && <label className="saved-character-picker">Open character<select aria-label="Open saved character" value={sheet.characterId} onChange={(event) => sheet.selectCharacter(event.target.value)}><option value={sheet.characterId}>{character.name}{sheet.savedCharacters.some((item) => item.id === sheet.characterId) ? "" : " (current)"}</option>{sheet.savedCharacters.filter((item) => item.id !== sheet.characterId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button type="button" onClick={() => setLifecycleMode("create")}>Create character</button>
          <button type="button" title={`Create a saved copy of ${character.name}`} onClick={() => void duplicateCurrent()}>Duplicate</button>
          {character.advancementSlots?.length ? <button type="button" onClick={() => setLifecycleMode("level-up")}>Level up</button> : null}
          <input ref={importInput} type="file" accept="application/json,.json" hidden aria-label="Import a ThreepointPF character or library .json file" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <button type="button" title="Import one character or restore a roster from a ThreepointPF .json backup" onClick={() => importInput.current?.click()}>Import JSON</button>
          <button type="button" title={`Download ${character.name} as a ThreepointPF .json file`} onClick={exportCurrent}>Export .json</button>
          <details className="character-library-tools"><summary>Roster backup</summary><div className="character-library-menu"><p>Import JSON above accepts a character file or a full roster backup.</p><button type="button" onClick={() => void exportLibrary()}>Export all characters</button></div></details>
        </ManagementContainer>
        <div className="top-actions">
          <span className={`status-dot${sheet.isDirty ? " is-dirty" : ""}`} />
          <span className="sheet-notice" role="status" aria-live="polite" title={sheet.isDirty ? "Save these changes before switching or reloading the character." : sheet.notice}>
            {sheet.isSaving ? "Saving…" : sheet.isDirty ? "Unsaved changes" : sheet.notice}
          </span>
          {sheet.integrationNotice && (
            <span
              className="sheet-integration-notice"
              role="status"
              aria-live="polite"
            >
              {sheet.integrationNotice}
            </span>
          )}
          {sheet.mode === "hosted" && (sheet.lastHostedRoll?.delivery.state === "retryable_failed" || sheet.lastHostedRoll?.delivery.state === "delivery_unknown") && (
            <button type="button" className="button quiet" onClick={() => void sheet.retryHostedDelivery()}>
              Retry sending
            </button>
          )}
          {onOpenWorkspace && (
            <button
              className="button quiet"
              data-testid="open-workspace"
              onClick={onOpenWorkspace}
            >
              Workspace
            </button>
          )}
          <button className="button quiet" onClick={sheet.reload}>
            Reload
          </button>
          <button className="button primary" onClick={sheet.save}>
            Save character
          </button>
        </div>
      </header>
      {sheet.mode === "hosted" && sheet.rollHistory.length > 0 && (
        <details className="hosted-roll-history panel">
          <summary>Recent recorded rolls ({sheet.rollHistory.length})</summary>
          <ol>
            {sheet.rollHistory.map((roll) => <li key={roll.rollId}>
              <span><b>{roll.plan.label}</b> · {roll.result.total} · {new Date(roll.createdAt).toLocaleString()}</span>
              <span>{hostedDeliveryNotice(roll.delivery)} Reference: {roll.rollId.slice(0, 8)}</span>
              {(roll.delivery.state === "retryable_failed" || roll.delivery.state === "delivery_unknown") &&
                <button type="button" className="button quiet" onClick={() => void sheet.retryHostedDelivery(roll)}>Retry sending</button>}
            </li>)}
          </ol>
        </details>
      )}
      {lifecycleMode && <LifecycleWizard mode={lifecycleMode} sheet={sheet} onClose={() => setLifecycleMode(null)} />}
      {pendingCharacterImport && <div className="character-import-conflict-backdrop"><section className="character-import-conflict" role="dialog" aria-modal="true" aria-labelledby={`${viewId}-import-conflict-title`}>
        <h2 id={`${viewId}-import-conflict-title`}>Character already exists</h2>
        <p><b>{pendingCharacterImport.incomingName}</b> from <b>{pendingCharacterImport.fileName}</b> has the same character ID as <b>{pendingCharacterImport.existingName}</b> in your library.</p>
        <p>Import as a copy to keep both characters, or replace the saved character.</p>
        <footer>
          <button type="button" onClick={() => setPendingCharacterImport(null)}>Cancel</button>
          <button type="button" autoFocus onClick={() => resolveCharacterImport("copy")}>Import as copy</button>
          <button type="button" className="primary" onClick={() => resolveCharacterImport("replace")}>Replace existing</button>
        </footer>
      </section></div>}
      {managementNotice && <p role="status" className="character-management-feedback">{managementNotice}</p>}
      {managementError && <p role="alert" className="error-banner">{managementError}</p>}
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
              <b>{sheet.mode === "browser" ? "Browser storage" : "Hosted account"}</b>
            </div>
          </div>
          <div className="identity-tags">
            <span>
              {featureCount} active feature{featureCount === 1 ? "" : "s"}
            </span>
            <span>
              {equippedCount} equipped item{equippedCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="hero-meta level-summary">
          <span>Level {level}</span>
          <b>{formatModifier(derived.bab.value)} BAB</b>
          <div className="level-rule" aria-hidden="true">
            <span
              style={{
                width: Math.min(100, Math.max(18, level * 12)) + "%",
              }}
            />
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
      <nav
        className="sheet-tabs"
        aria-label="Character sheet sections"
        role="tablist"
      >
        {sheetTabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              className={selected ? "active" : ""}
              type="button"
              role="tab"
              id={viewId + "-sheet-tab-" + tab.id}
              aria-selected={selected}
              aria-controls={viewId + "-sheet-panel-" + tab.id}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(node) => {
                if (node) tabButtons.current.set(tab.id, node);
                else tabButtons.current.delete(tab.id);
              }}
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
          id={viewId + "-sheet-panel-summary"}
          aria-labelledby={viewId + "-sheet-tab-summary"}
          tabIndex={0}
          hidden={activeTab !== "summary"}
        >
          <SummarySheet sheet={sheet} onSelectTab={selectTab} />
          <div className="summary-utilities">
            <SamplePanel sheet={sheet} />
          </div>
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-spells"}
          aria-labelledby={viewId + "-sheet-tab-spells"}
          tabIndex={0}
          hidden={activeTab !== "spells"}
        >
          <SpellcastingPanel sheet={sheet} />
          <WorkbookSystemsPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-attributes"}
          aria-labelledby={viewId + "-sheet-tab-attributes"}
          tabIndex={0}
          hidden={activeTab !== "attributes"}
        >
          <InputsPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-combat"}
          aria-labelledby={viewId + "-sheet-tab-combat"}
          tabIndex={0}
          hidden={activeTab !== "combat"}
        >
          <DefensesPanel sheet={sheet} />
          <AttacksPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-inventory"}
          aria-labelledby={viewId + "-sheet-tab-inventory"}
          tabIndex={0}
          hidden={activeTab !== "inventory"}
        >
          <EquipmentPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-features"}
          aria-labelledby={viewId + "-sheet-tab-features"}
          tabIndex={0}
          hidden={activeTab !== "features"}
        >
          <FeaturesPanel sheet={sheet} />
          <ActiveCapabilities sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-skills"}
          aria-labelledby={viewId + "-sheet-tab-skills"}
          tabIndex={0}
          hidden={activeTab !== "skills"}
        >
          <SkillsPanel sheet={sheet} />
        </section>
        <section
          className="sheet-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-advancement"}
          aria-labelledby={viewId + "-sheet-tab-advancement"}
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
          id={viewId + "-sheet-panel-notes"}
          aria-labelledby={viewId + "-sheet-tab-notes"}
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
          <CharacterNotesPanel character={character} update={sheet.update} />
        </section>
        <section
          className="sheet-tab-panel settings-tab-panel"
          role="tabpanel"
          id={viewId + "-sheet-panel-settings"}
          aria-labelledby={viewId + "-sheet-tab-settings"}
          tabIndex={0}
          hidden={activeTab !== "settings"}
        >
          <section className="settings-intro panel">
            <span className="eyebrow">APPLICATION SETTINGS</span>
            <h2>Dice and table integrations</h2>
            <p className="muted">
              These settings belong to this browser, not to the active character.
              Switching characters leaves them intact.
            </p>
          </section>
          <ThemeSettingsPanel theme={theme} />
          <DiceSettingsPanel dice={sheet.dice} />
          {sheet.mode === "browser" && <DiscordSettingsPanel discord={sheet.discord} />}
          <WorkbookGuide />
        </section>
      </TabWorkspace>
    </section>
  );
}
