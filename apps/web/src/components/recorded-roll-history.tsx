import type { HostedRollResponse } from "@threepointpf/shared";
import type { useRecordedRollHistory } from "../hooks/useRecordedRollHistory";
import { hostedDeliveryNotice } from "../lib/hosted-roll";

type History = ReturnType<typeof useRecordedRollHistory>;
export function RecordedRollHistory({ history, retryDelivery }: {
  history: History;
  retryDelivery: (roll: HostedRollResponse) => Promise<void>;
}) {
  return <details className="hosted-roll-history panel">
    <summary>Recorded rolls ({history.rollHistory.length})</summary>
    <p className="muted">Saved roll results and Discord delivery status, newest first.</p>
    <ol aria-label="Recorded rolls">
      {history.rollHistory.map((roll) => <li key={roll.rollId}>
        <span><b>{roll.plan.label}</b> · {roll.result.total} · {new Date(roll.createdAt).toLocaleString()}</span>
        <span>{hostedDeliveryNotice(roll.delivery)} Reference: {roll.rollId.slice(0, 8)}</span>
        {(roll.delivery.state === "retryable_failed" || roll.delivery.state === "delivery_unknown") &&
          <button type="button" className="button quiet" onClick={() => void retryDelivery(roll)}>Retry sending</button>}
      </li>)}
    </ol>
    {history.rollHistoryLoading && <p className="muted" role="status">Loading recorded rolls…</p>}
    {history.rollHistoryError && <p className="muted" role="status">{history.rollHistoryError}</p>}
    {history.rollHistoryLoaded && !history.rollHistoryLoading && !history.rollHistoryError && history.rollHistory.length === 0 && <p className="muted">No recorded rolls yet.</p>}
    <div className="hosted-roll-history-actions">
      {history.hasOlderRolls && <button type="button" className="button quiet" disabled={history.rollHistoryLoading} onClick={() => void history.loadOlderRolls()}>Load older rolls</button>}
      <button type="button" className="button quiet" disabled={history.rollHistoryLoading} onClick={() => void history.refreshRollHistory()}>{history.rollHistoryError && !history.hasOlderRolls ? "Retry history" : "Refresh history"}</button>
      {history.rollHistoryLoaded && !history.hasOlderRolls && history.rollHistory.length > 0 && <span className="muted">All recorded rolls loaded.</span>}
    </div>
  </details>;
}
