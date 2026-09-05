import "server-only";

import { clearedState, emptyState, isDraftStateFile } from "@/lib/draft-engine";
import { createServiceClient } from "@/lib/supabase/server";
import type { DraftStore } from "@/lib/draft-store";
import type { DraftStateFile } from "@/lib/draft-types";
import type { Json } from "@/lib/supabase/types";

/**
 * The draft board, saved to Postgres instead of to a file.
 *
 * Used whenever the database is configured, which on a deployment is the only
 * way the board can be saved at all: the filesystem there is read-only, and the
 * file store's first write comes back `EROFS`. It is also the only way two
 * devices see one draft, since every instance has its own disk.
 *
 * The document written is byte-for-byte what the file store wrote — a whole
 * `DraftStateFile` — so a board can be moved between the two by copying the
 * JSON, and `db:import:draft --state-file=…` still takes either one.
 *
 * WRITES ARE CONDITIONAL. Every row carries a `revision`; a write names the
 * revision it was derived from and is refused if the stored board has moved
 * since. In one process the store also queues, as the file store does, so this
 * only bites across instances — which is exactly the case the file store could
 * not see and would have resolved by silently dropping somebody's pick.
 */

/** Enough to cover a whole draft twice over; older ones are pruned. */
const BACKUPS_KEPT = 400;

/**
 * `DraftStateFile` has no index signature, so it is not structurally a `Json`
 * even though it is one. The column is `jsonb` and the value is a plain
 * serialisable object; this is the whole of the impedance mismatch.
 */
function toJson(state: DraftStateFile): Json {
  return state as unknown as Json;
}

function conflict(): Error {
  return new Error(
    "Another device saved to the board while this change was being made, so it " +
      "was NOT saved. Reload the board to see what is stored, then enter it again.",
  );
}

/**
 * Serialises access within the process, for the same reason the file store
 * does: two picks landing at once must not interleave a read-modify-write.
 *
 * One turn per mutation, not one per statement — `mutate` holds it across the
 * read and the write. Nothing inside a turn may call back into here, so the
 * methods below split into a locking half and a `…Now` half that assumes the
 * lock is already held.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export class SupabaseDraftStore implements DraftStore {
  /**
   * The revision each state was read at, keyed on the object rather than on the
   * season: two requests can be mid read-modify-write at the same moment and
   * each has to name its own base, or the second one's conditional write would
   * be checked against the first one's revision and overwrite it.
   */
  private readonly revisions = new WeakMap<DraftStateFile, number>();

  async read(season: number, boardFingerprint: string): Promise<DraftStateFile> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("draft_live_state")
      .select("state, revision")
      .eq("season", season)
      .maybeSingle();

    if (error) {
      throw new Error(`Reading the draft board from the database failed: ${error.message}`);
    }

    if (!data) {
      // No row is a draft that has not started, not a failure.
      const fresh = emptyState(season, boardFingerprint);
      this.revisions.set(fresh, 0);
      return fresh;
    }

    if (!isDraftStateFile(data.state)) {
      throw new Error(
        `The stored draft board for ${season} is not a draft state file. Every ` +
          `previous save is in draft_live_backups — recover the newest good one ` +
          `rather than deleting the row.`,
      );
    }

    const state = data.state as DraftStateFile;
    this.revisions.set(state, data.revision);
    return state;
  }

  async write(state: DraftStateFile, base: DraftStateFile): Promise<void> {
    return serialize(() => this.writeNow(state, base));
  }

  async mutate(
    season: number,
    boardFingerprint: string,
    change: (state: DraftStateFile) => DraftStateFile,
  ): Promise<DraftStateFile> {
    return serialize(async () => {
      const state = await this.read(season, boardFingerprint);
      const next = change(state);
      await this.writeNow(next, state);
      return next;
    });
  }

  /** The conditional write itself. Assumes the queue's turn is already held. */
  private async writeNow(state: DraftStateFile, base: DraftStateFile): Promise<void> {
    const supabase = createServiceClient();
    const revision = await this.baseRevision(base);
    const next = revision + 1;
    const row = {
      season: state.season,
      state: toJson(state),
      revision: next,
      updated_at: state.updatedAt,
    };

    if (revision === 0) {
      // Nothing was stored when this state was read, so this is the first
      // save of the draft. A unique violation means another instance got
      // there first, which is the same conflict as a stale revision.
      const { error } = await supabase.from("draft_live_state").insert(row);
      if (error) {
        if (error.code === "23505") throw conflict();
        throw new Error(`Saving the draft board failed: ${error.message}`);
      }
    } else {
      const { data, error } = await supabase
        .from("draft_live_state")
        .update(row)
        .eq("season", state.season)
        .eq("revision", revision)
        .select("revision");
      if (error) throw new Error(`Saving the draft board failed: ${error.message}`);
      if (!data?.length) throw conflict();
    }

    this.revisions.set(state, next);
    await this.backup(state);
  }

  async clear(season: number, boardFingerprint: string): Promise<DraftStateFile> {
    // One turn for the whole wipe, so a pick cannot land between the board
    // being read for the restore point and the empty board replacing it — which
    // is a pick that is gone from the board and absent from what undo offers
    // to put back.
    return serialize(async () => {
      const current = await this.read(season, boardFingerprint);
      // Reset is destructive by definition, so the pre-reset board is archived
      // before it goes. Nothing is ever deleted outright.
      if (current.picks.length) await this.backup(current);

      // The wiped picks ride along inside the state that replaces them, so undo
      // can put them back without anyone going to the archive to do it.
      const cleared = clearedState(current, season, boardFingerprint);
      await this.writeNow(cleared, current);
      return cleared;
    });
  }

  /** Where a save lands, for the line in the board's footer. */
  location(): string {
    return "the league database";
  }

  private async baseRevision(base: DraftStateFile): Promise<number> {
    const known = this.revisions.get(base);
    if (known !== undefined) return known;

    // A state this store did not hand out — a recovered file, or a script. Take
    // the stored revision as the base so the write still lands.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("draft_live_state")
      .select("revision")
      .eq("season", base.season)
      .maybeSingle();
    if (error) throw new Error(`Reading the draft board from the database failed: ${error.message}`);
    return data?.revision ?? 0;
  }

  /**
   * A timestamped copy of every save. Failing to write one is logged and
   * swallowed: a backup is worth a great deal on Sunday morning and is not
   * worth refusing a pick on Saturday night.
   */
  private async backup(state: DraftStateFile): Promise<void> {
    const supabase = createServiceClient();
    try {
      const { error } = await supabase
        .from("draft_live_backups")
        .insert({ season: state.season, state: toJson(state) });
      if (error) throw new Error(error.message);

      const { data } = await supabase
        .from("draft_live_backups")
        .select("created_at")
        .eq("season", state.season)
        .order("created_at", { ascending: false })
        .range(BACKUPS_KEPT, BACKUPS_KEPT);

      const oldest = data?.[0]?.created_at;
      if (oldest) {
        await supabase
          .from("draft_live_backups")
          .delete()
          .eq("season", state.season)
          .lt("created_at", oldest);
      }
    } catch (err) {
      console.error(
        `[draft-store] the board saved but its backup did not: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
