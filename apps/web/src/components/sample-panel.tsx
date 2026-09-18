import type { CharacterSheet } from "../hooks/useCharacterSheet";

/**
 * Where a sheet comes from, and what backs it. In demo mode this is the first
 * thing on the page: the whole application — samples, rules engine and browser
 * storage — runs without a server, so there is nothing to sign into and nothing
 * to configure before trying it.
 */
export function SamplePanel({ sheet }: { sheet: CharacterSheet }) {
  const demo = sheet.mode === "demo";
  const current =
    sheet.samples.find((sample) => sample.id === sheet.sampleId) ??
    sheet.samples[0];
  return (
    <section className="panel sample-panel" data-testid="sample-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {demo ? "DEMO MODE · NO SERVER" : "SAMPLES"}
          </span>
          <h2>{demo ? "Open a sample and try anything" : "Start from a sample"}</h2>
        </div>
        <span className="pill" data-testid="sheet-mode">
          {demo ? "DEMO" : "SUPABASE"}
        </span>
      </div>
      <p className="muted">
        {demo
          ? "Everything runs in this browser: the rules engine recomputes every number from authored state, and saving keeps your edits in this browser's storage. Nothing is sent anywhere."
          : "A sample is ordinary authored state, so every derived number on the sheet is recomputed from it. Load one, edit it, or save it to your account."}
      </p>
      <div className="sample-row">
        <label className="field">
          <span>Sample character</span>
          <select
            data-testid="sample-character"
            value={sheet.sampleId}
            onChange={(event) => sheet.loadSample(event.target.value)}
          >
            {sheet.samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button quiet"
          data-testid="sample-reset"
          onClick={sheet.resetSample}
        >
          Reset sample
        </button>
      </div>
      {current && <p className="muted">{current.description}</p>}
    </section>
  );
}
