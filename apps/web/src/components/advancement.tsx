import type {
  AdvancementSlot,
  DerivedProgressionFeature,
  EvaluationResult,
  ProgressionCatalog,
  ProgressionDefinition,
} from "@threepointpf/rules-schema";
import { catalogValues, nextId, sourceLabel } from "../lib/format";

export function AdvancementEditor({
  slots,
  catalog,
  change,
  fail,
}: {
  slots?: AdvancementSlot[];
  catalog: ProgressionCatalog;
  change: (slots: AdvancementSlot[]) => void;
  fail: (message: string) => void;
}) {
  const definitions = catalogValues(catalog);
  const first =
    definitions.find((definition) => definition.id === "pf1e.paizo.fighter")
      ?.id ?? definitions[0]?.id;
  if (!slots?.length)
    return (
      <section className="panel advancement-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ADVANCEMENT</span>
            <h2>Ordered progression tracks</h2>
          </div>
          <span className="helper">N-track / no gestalt flag</span>
        </div>
        <p className="advancement-copy">
          A class level is character-global while each BAB/save increment
          remains credited to the track that occupied that slot.
        </p>
        <button
          className="button quiet"
          data-testid="advancement-start"
          disabled={!first}
          onClick={() =>
            first &&
            change([
              {
                id: "level-1",
                tracks: [{ id: "track-1", entry: { progressionId: first } }],
              },
            ])
          }
        >
          {first ? "Start advancement" : "No progression definitions available"}
        </button>
      </section>
    );
  const trackIds = slots[0]?.tracks.map((track) => track.id) ?? [];
  const select = (slotId: string, trackId: string, progressionId: string) => {
    const slot = slots.find((item) => item.id === slotId);
    if (
      slot?.tracks.some(
        (track) =>
          track.id !== trackId && track.entry.progressionId === progressionId,
      )
    ) {
      fail(
        "A class may only occupy one track in the same character-level slot.",
      );
      return;
    }
    change(
      slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              tracks: slot.tracks.map((track) =>
                track.id === trackId
                  ? { ...track, entry: { progressionId } }
                  : track,
              ),
            }
          : slot,
      ),
    );
  };
  const addLevel = () => {
    const previous = slots[slots.length - 1]!;
    change([
      ...slots,
      {
        id: nextId(
          "level",
          slots.map((slot) => slot.id),
        ),
        tracks: previous.tracks.map((track) => ({
          id: track.id,
          entry: { progressionId: track.entry.progressionId },
        })),
      },
    ]);
  };
  const addTrack = () => {
    if (definitions.length <= trackIds.length) {
      fail(
        "This row already uses every available progression. Add a custom class or use fewer tracks.",
      );
      return;
    }
    const id = nextId("track", trackIds);
    change(
      slots.map((slot) => {
        const used = new Set(
          slot.tracks.map((track) => track.entry.progressionId),
        );
        const available = definitions.find(
          (definition) => !used.has(definition.id),
        );
        return available
          ? {
              ...slot,
              tracks: [
                ...slot.tracks,
                { id, entry: { progressionId: available.id } },
              ],
            }
          : slot;
      }),
    );
  };
  return (
    <section className="panel advancement-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ADVANCEMENT</span>
          <h2>Ordered progression tracks</h2>
        </div>
        <span className="helper">
          {slots.length} levels · {trackIds.length} tracks
        </span>
      </div>
      <p className="advancement-copy">
        Choices are validated before they are applied. A disabled option is
        already used by another track in that same row.
      </p>
      <div className="advancement-grid-wrap">
        <table className="advancement-grid">
          <thead>
            <tr>
              <th>Level</th>
              {trackIds.map((trackId, index) => (
                <th key={trackId}>
                  Track {index + 1}
                  <button
                    className="table-action"
                    aria-label={"Remove track " + (index + 1)}
                    disabled={trackIds.length === 1}
                    onClick={() =>
                      trackIds.length > 1 &&
                      change(
                        slots.map((slot) => ({
                          ...slot,
                          tracks: slot.tracks.filter(
                            (track) => track.id !== trackId,
                          ),
                        })),
                      )
                    }
                  >
                    ×
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, row) => (
              <tr key={slot.id}>
                <th>Level {row + 1}</th>
                {slot.tracks.map((track, column) => {
                  const used = new Set(
                    slot.tracks
                      .filter((item) => item.id !== track.id)
                      .map((item) => item.entry.progressionId),
                  );
                  return (
                    <td key={track.id}>
                      <select
                        aria-label={
                          "Level " +
                          (row + 1) +
                          " track " +
                          (column + 1) +
                          " progression"
                        }
                        value={track.entry.progressionId}
                        onChange={(event) =>
                          select(slot.id, track.id, event.target.value)
                        }
                      >
                        {definitions.map((definition) => (
                          <option
                            key={definition.id}
                            value={definition.id}
                            disabled={used.has(definition.id)}
                          >
                            {definition.name} ·{" "}
                            {definition.source?.category ?? "Custom"}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="advancement-actions">
        <button
          className="button quiet"
          data-testid="advancement-add-level"
          onClick={addLevel}
        >
          + Level
        </button>
        <button
          className="button quiet"
          data-testid="advancement-remove-level"
          disabled={slots.length === 1}
          onClick={() => slots.length > 1 && change(slots.slice(0, -1))}
        >
          − Last level
        </button>
        <button
          className="button quiet"
          data-testid="advancement-add-track"
          onClick={addTrack}
        >
          + Track
        </button>
      </div>
    </section>
  );
}

export function AdvancementSummary({
  levels,
  features,
  catalog,
  inspect,
}: {
  levels: Record<string, EvaluationResult>;
  features: DerivedProgressionFeature[];
  catalog: ProgressionCatalog;
  inspect: (label: string, result: EvaluationResult) => void;
}) {
  if (!Object.keys(levels).length) return null;
  return (
    <section className="panel advancement-summary">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DERIVED ADVANCEMENT</span>
          <h2>Global progression levels</h2>
        </div>
        <span className="helper">Click for provenance</span>
      </div>
      <div className="progression-levels">
        {Object.entries(levels).map(([id, result]) => {
          const definition = catalog[id];
          const name = definition?.name ?? id;
          return (
            <button
              className="progression-level"
              data-testid={"progression-level-" + id}
              key={id}
              onClick={() => inspect(name + " level", result)}
            >
              <span>{name}</span>
              <strong>Level {result.value}</strong>
              <small>{sourceLabel(definition?.source)} · inspect →</small>
            </button>
          );
        })}
      </div>
      {features.length > 0 && (
        <div className="progression-features">
          <span className="eyebrow">UNLOCKED CLASS / SUBCLASS NOTES</span>
          {features.map((feature) => (
            <div
              key={
                feature.progressionId +
                "-" +
                feature.id +
                "-" +
                feature.slotId +
                "-" +
                feature.trackId
              }
            >
              <b>{feature.name}</b>
              <small>
                {feature.description ??
                  feature.progressionId + " level " + feature.level}{" "}
                · {feature.trackId}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
