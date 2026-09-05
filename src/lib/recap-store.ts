import "server-only";

/**
 * Where the recap lives between page loads.
 *
 * SAME TWO BACKENDS AS THE DRAFT BOARD, AND FOR THE SAME REASON. A file under
 * `data/` where the disk is writable, a Postgres row where it is not — which a
 * deployment always is, its filesystem being read-only and its first write
 * coming back `EROFS`. `@/lib/draft-store` explains the reasoning at length and
 * this module follows it deliberately rather than inventing a second
 * convention: `RECAP_STORE=file|database` overrides the detection exactly as
 * `DRAFT_STORE` does, and the document written is identical either way.
 *
 * WHAT IS DELIBERATELY NOT COPIED FROM THE DRAFT STORE. No backup directory, no
 * conditional write, no revision counter. Those exist because losing the live
 * board means re-entering ninety picks from memory in front of ten people. A
 * recap costs a button press and a couple of minutes to make again, and the
 * league's stated preference is recovery over prevention — so re-generating IS
 * the recovery, and guarding the write would only make the cheap thing harder.
 * The last write wins, on purpose.
 *
 * A recap that cannot be read is treated as absent rather than as an error. The
 * tab has every number in it without a recap and is worth drawing regardless;
 * refusing to render a draft board because a blurb file went bad would be the
 * wrong trade.
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { createServiceClient } from "@/lib/supabase/server";
import { hasDatabase } from "@/lib/env";
import { isRecapDocument, type RecapDocument } from "@/lib/recap-types";
import type { Json } from "@/lib/supabase/types";

const DATA_DIR = path.join(process.cwd(), "data");

function recapFile(season: number): string {
  return path.join(DATA_DIR, `draft-recap-${season}.json`);
}

export interface RecapStore {
  /** Null for "not generated yet", which is a normal state, not a failure. */
  read(season: number): Promise<RecapDocument | null>;
  write(recap: RecapDocument): Promise<void>;
  /** Where a save lands, for the line under the generate button. */
  location(season: number): string;
}

class JsonFileRecapStore implements RecapStore {
  async read(season: number): Promise<RecapDocument | null> {
    const file = recapFile(season);
    if (!existsSync(file)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return isRecapDocument(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(recap: RecapDocument): Promise<void> {
    const target = recapFile(recap.season);
    mkdirSync(DATA_DIR, { recursive: true });
    // Temp-then-rename, so a crash mid-write cannot leave half a recap behind
    // for the page to try to render.
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(recap, null, 2)}\n`, "utf8");
    renameSync(tmp, target);
  }

  location(season: number): string {
    return path.relative(process.cwd(), recapFile(season));
  }
}

class SupabaseRecapStore implements RecapStore {
  async read(season: number): Promise<RecapDocument | null> {
    const { data, error } = await createServiceClient()
      .from("draft_recap")
      .select("recap")
      .eq("season", season)
      .maybeSingle();

    if (error || !data) return null;
    return isRecapDocument(data.recap) ? data.recap : null;
  }

  async write(recap: RecapDocument): Promise<void> {
    const { error } = await createServiceClient()
      .from("draft_recap")
      .upsert(
        {
          season: recap.season,
          recap: recap as unknown as Json,
          updated_at: recap.generatedAt,
        },
        { onConflict: "season" },
      );
    if (error) throw new Error(`Saving the recap failed: ${error.message}`);
  }

  location(): string {
    return "the league database";
  }
}

/** Resolved once, matching `@/lib/draft-store`'s reasoning about the disk. */
let backend: RecapStore | null = null;
function store(): RecapStore {
  if (backend) return backend;

  const forced = process.env.RECAP_STORE?.toLowerCase();
  if (forced === "database") backend = new SupabaseRecapStore();
  else if (forced === "file") backend = new JsonFileRecapStore();
  else if (dataDirIsWritable()) backend = new JsonFileRecapStore();
  else if (hasDatabase()) backend = new SupabaseRecapStore();
  else backend = new JsonFileRecapStore();

  return backend;
}

/** Whether this machine will let us save a file where the recap goes. */
function dataDirIsWritable(): boolean {
  try {
    accessSync(existsSync(DATA_DIR) ? DATA_DIR : process.cwd(), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const recapStore: RecapStore = {
  read: (season) => store().read(season),
  write: (recap) => store().write(recap),
  location: (season) => store().location(season),
};

export function recapLocation(season: number): string {
  return store().location(season);
}
