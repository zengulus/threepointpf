import { useEffect, useState } from "react";
import {
  maskDiscordWebhookUrl,
  testDiscordWebhook,
  validateDiscordWebhookUrl,
} from "../lib/discord-roll-publishing";
import type { DiscordRollSettingsController } from "../hooks/useDiscordRollSettings";

/**
 * A small credential editor that never renders an already-stored webhook token
 * back into the page. Replacing a URL starts with an empty password field.
 */
export function DiscordSettingsPanel({
  discord,
}: {
  discord: DiscordRollSettingsController;
}) {
  const { settings, updateSettings, clearWebhook, persistenceNotice } = discord;
  const [editingWebhook, setEditingWebhook] = useState(!settings.webhookUrl);
  const [webhookDraft, setWebhookDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings.webhookUrl) setEditingWebhook(true);
  }, [settings.webhookUrl]);

  const saveWebhook = () => {
    const validation = validateDiscordWebhookUrl(webhookDraft);
    if (!validation.valid) {
      setFeedback(validation.message);
      return;
    }
    updateSettings({ webhookUrl: validation.value, enabled: false });
    setWebhookDraft("");
    setEditingWebhook(false);
    setFeedback("Webhook saved. Enable publishing when you are ready.");
  };

  const clear = () => {
    clearWebhook();
    setWebhookDraft("");
    setEditingWebhook(true);
    setFeedback("Webhook cleared. Discord publishing is disabled.");
  };

  const testConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      await testDiscordWebhook(settings);
      setFeedback("Test message sent to Discord.");
    } catch (failure) {
      // The publisher deliberately produces credential-safe messages only.
      setFeedback(
        failure instanceof Error
          ? failure.message
          : "Discord test message could not be sent.",
      );
    } finally {
      setTesting(false);
    }
  };

  const configured = Boolean(settings.webhookUrl);
  return (
    <section className="panel discord-settings-panel" aria-labelledby="discord-settings-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ROLL INTEGRATION</span>
          <h2 id="discord-settings-title">Discord roll publishing</h2>
        </div>
        <span className="pill">optional</span>
      </div>
      <p className="muted">
        Completed local rolls can also be posted to one Discord channel. Your
        webhook stays in this browser and is never saved with a character.
      </p>
      <div className="discord-settings-grid">
        <div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              data-testid="discord-enabled"
              checked={settings.enabled}
              disabled={!configured}
              title={configured ? undefined : "Save a Discord webhook before enabling publishing"}
              onChange={(event) =>
                updateSettings({ enabled: event.target.checked })
              }
            />
            <span>Publish completed rolls to Discord</span>
          </label>
          {!configured && (
            <small className="muted">Save a webhook before enabling publishing.</small>
          )}
        </div>
        <label className="field">
          <span>Display name (optional)</span>
          <input
            aria-label="Discord display name"
            maxLength={80}
            placeholder="Character sheet"
            value={settings.displayName}
            onChange={(event) =>
              updateSettings({ displayName: event.target.value })
            }
          />
        </label>
      </div>
      <div className="discord-webhook-row">
        <div>
          <span className="field-label">Discord webhook</span>
          {configured && !editingWebhook ? (
            <code data-testid="discord-webhook-masked">
              {maskDiscordWebhookUrl(settings.webhookUrl)}
            </code>
          ) : (
            <label className="field discord-webhook-input">
              <span className="sr-only">Discord webhook URL</span>
              <input
                type="password"
                autoComplete="off"
                aria-label="Discord webhook URL"
                data-testid="discord-webhook-url"
                placeholder="https://discord.com/api/webhooks/…"
                value={webhookDraft}
                onChange={(event) => setWebhookDraft(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="discord-webhook-actions">
          {configured && !editingWebhook ? (
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                setEditingWebhook(true);
                setFeedback(null);
              }}
            >
              Replace webhook
            </button>
          ) : (
            <button
              type="button"
              className="button quiet"
              onClick={saveWebhook}
            >
              Save webhook
            </button>
          )}
          {configured && (
            <button
              type="button"
              className="button quiet"
              data-testid="discord-clear-webhook"
              onClick={clear}
            >
              Clear webhook
            </button>
          )}
          <button
            type="button"
            className="button primary"
            data-testid="discord-test-connection"
            disabled={!configured || testing}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test connection/message"}
          </button>
        </div>
      </div>
      <p className="muted discord-credential-note">
        Stored webhook tokens are masked here. Clearing removes the token and
        turns publishing off.
      </p>
      {(feedback || persistenceNotice) && (
        <p className="settings-feedback" role="status" aria-live="polite">
          {feedback ?? persistenceNotice}
        </p>
      )}
    </section>
  );
}
