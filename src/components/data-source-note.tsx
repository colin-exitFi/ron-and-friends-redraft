import { Database, FileJson, TriangleAlert } from "lucide-react";

/**
 * Says where the page's numbers came from.
 *
 * These pages read the league database when it is connected and the Smart Draft
 * snapshots in `data/` when it is not. Which one is in play changes how fresh
 * the numbers are, so it is stated rather than left for the commissioner to
 * guess — and a database read that failed and fell back says so out loud.
 */
export function DataSourceNote({
  fromDatabase,
  fallbackReason,
  fetchedAt,
  snapshotLabel = "the board snapshot in data/",
}: {
  fromDatabase: boolean;
  fallbackReason?: string | null;
  /** When the snapshot behind this was pulled. */
  fetchedAt?: string | null;
  snapshotLabel?: string;
}) {
  const pulled = fetchedAt
    ? new Date(fetchedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  if (fallbackReason) {
    return (
      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <TriangleAlert className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          The league database is configured but could not be read, so this is{" "}
          {snapshotLabel}
          {pulled ? `, pulled ${pulled}` : ""}.{" "}
          <span className="font-mono">{fallbackReason}</span>
        </span>
      </p>
    );
  }

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-xs">
      {fromDatabase ? (
        <>
          <Database className="h-3.5 w-3.5 shrink-0" />
          <span>Live from the league database.</span>
        </>
      ) : (
        <>
          <FileJson className="h-3.5 w-3.5 shrink-0" />
          <span>
            Read from {snapshotLabel}
            {pulled ? `, pulled ${pulled}` : ""}. Re-pull it to refresh.
          </span>
        </>
      )}
    </p>
  );
}
