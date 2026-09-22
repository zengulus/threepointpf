import type { ThemePreferenceController } from "../hooks/useThemePreference";

export function ThemeSettingsPanel({
  theme,
}: {
  theme: ThemePreferenceController;
}) {
  return (
    <section className="panel theme-settings-panel" aria-labelledby="theme-settings-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">APPLICATION APPEARANCE</span>
          <h2 id="theme-settings-title">Theme</h2>
        </div>
      </div>
      <p className="muted">
        Choose the sheet surface that is most comfortable at your table. This
        setting belongs to this browser, not to a character.
      </p>
      <label className="field theme-choice">
        <span>Colour theme</span>
        <select
          aria-label="Colour theme"
          data-testid="theme-preference"
          value={theme.theme}
          onChange={(event) => theme.updateTheme(event.target.value)}
        >
          <option value="parchment">Parchment</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      {theme.persistenceNotice && (
        <p className="settings-feedback" role="status" aria-live="polite">
          {theme.persistenceNotice}
        </p>
      )}
    </section>
  );
}
