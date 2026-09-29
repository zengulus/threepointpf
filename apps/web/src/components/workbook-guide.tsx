import { autosheetBonusTypeReference } from "@threepointpf/rules-data";

export function WorkbookGuide() {
  return <section className="panel workbook-guide">
    <div className="panel-heading">
      <div><span className="eyebrow">AUTOSHEET · QUICK GUIDE</span><h2>Using the character sheet</h2></div>
      <span className="helper">Adapted from the workbook’s Welcome Page</span>
    </div>
    <div className="workbook-guide-grid">
      <section className="side-note"><h3>Shared characters</h3><p>Sign in with the local campaign account provided by your GM. Characters are stored with the campaign, so its users can work on the same character.</p></section>
      <section className="side-note"><h3>Enter character details</h3><p>Use Features for identity and character options, Attributes for ability scores, Advancement for class levels, and Notes for backstory and other written details. Authored entries stay with the character.</p></section>
      <section className="side-note"><h3>Choose rule options</h3><p>Features → Character details contains the skill variant, Unchained Wound thresholds, and minimum 4 + INT skill ranks options. Consolidated Skills uses the workbook’s 12 grouped skills and half-rank-per-level budget. Wound thresholds apply penalties below 75%, 50%, and 25% HP.</p></section>
      <section className="side-note"><h3>Read the calculated totals</h3><p>Summary and the other tabs show values derived from the character’s current scores, advancement, features, and equipment. Select an inspectable total to see the bonuses, penalties, and sources that contribute to it.</p></section>
      <section className="side-note"><h3>Bonus types in the workbook</h3><p>Reference labels from Formula References, A96:A110. The authored effect editor uses separate choices for combined labels and keeps precision damage as a damage type.</p><ul>{autosheetBonusTypeReference.map(({ label, source }) => <li key={source.range} title={`${source.sheet}!${source.range}`}>{label}</li>)}</ul></section>
      <section className="side-note"><h3>Roll and track combat</h3><p>Combat contains attacks and defenses; Summary contains health and damage controls. Enable situational features on Features before rolling. A roll shows its dice, modifier, and applicable effects; typed damage can apply resistance and damage reduction.</p></section>
      <section className="side-note"><h3>Track equipment and magic</h3><p>Inventory tracks carried gear, nested containers, encumbrance, and purchase balance. Spells holds prepared and known spells, plus the workbook’s maneuver, veilweaving, sphere, psionic, and FFd20 systems. Add a class chart to seed its progression, then author the entries your character uses.</p></section>
    </div>
  </section>;
}
