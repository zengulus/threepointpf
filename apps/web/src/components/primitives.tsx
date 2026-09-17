import { formatModifier } from "@threepointpf/dice";
import type { Contribution, EvaluationResult } from "@threepointpf/rules-schema";
import { sourceLabel } from "../lib/format";

export function StatCard({
  label,
  value,
  evaluation,
  inspect,
  testId,
}: {
  label: string;
  value: string | number;
  evaluation: EvaluationResult;
  inspect: () => void;
  testId: string;
}) {
  return (
    <button
      className="stat-card"
      data-testid={testId}
      onClick={inspect}
      title="Show calculation breakdown"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>inspect →</small>
    </button>
  );
}
export function ContributionTree({
  contribution,
  depth = 0,
}: {
  contribution: Contribution;
  depth?: number;
}) {
  return (
    <>
      <div className="contribution" style={{ marginLeft: depth * 12 }}>
        <span className="contribution-value">
          {formatModifier(contribution.value)}
        </span>
        <span>
          <b>{contribution.label}</b>
          <em>
            {contribution.note ?? contribution.bonusType ?? "base / derived"}
          </em>
          {contribution.sourceMetadata && (
            <em>{sourceLabel(contribution.sourceMetadata)}</em>
          )}
        </span>
      </div>
      {contribution.children?.map((child, index) => (
        <ContributionTree
          key={child.source + "-" + index}
          contribution={child}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
export function Breakdown({
  selected,
}: {
  selected: { label: string; evaluation: EvaluationResult } | null;
}) {
  if (!selected)
    return (
      <div className="breakdown empty">
        <span className="eyebrow">AUDIT TRAIL</span>
        <p>Select a calculated value to see its sources.</p>
      </div>
    );
  const excluded = selected.evaluation.excluded ?? [];
  return (
    <div className="breakdown">
      <div className="eyebrow">AUDIT TRAIL</div>
      <h3>
        {selected.label} <span>= {selected.evaluation.value}</span>
      </h3>
      {selected.evaluation.rollContext && (
        <p className="muted">
          Context: {selected.evaluation.rollContext.kind}
          {selected.evaluation.rollContext.mode
            ? " · " + selected.evaluation.rollContext.mode
            : ""}
          {selected.evaluation.rollContext.touch ? " · touch" : ""}
          {selected.evaluation.rollContext.fullAttack
            ? " · full attack"
            : ""}
          {selected.evaluation.rollContext.maneuver
            ? " · " + selected.evaluation.rollContext.maneuver
            : ""}
          {selected.evaluation.rollContext.flags?.length
            ? " · flags: " + selected.evaluation.rollContext.flags.join(", ")
            : ""}
        </p>
      )}
      <div className="contributions">
        {selected.evaluation.contributions.map((item, index) => (
          <ContributionTree
            key={item.source + "-" + index}
            contribution={item}
          />
        ))}
      </div>
      {excluded.length > 0 && (
        <div className="contributions excluded-contributions">
          <div className="eyebrow">EXCLUDED BY CONTEXT</div>
          {excluded.map((item, index) => (
            <div className="contribution excluded" key={item.source + "-" + index}>
              <span className="contribution-value">
                {formatModifier(item.value)}
              </span>
              <span>
                <b>{item.label}</b>
                <em>{item.reason}</em>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
