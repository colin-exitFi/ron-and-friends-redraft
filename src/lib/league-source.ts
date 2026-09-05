import "server-only";

import { hasDatabase } from "@/lib/env";
import {
  getFranchiseDetailFromJson,
  getFranchisesFromJson,
  getKeeperBoardFromJson,
  getTradeBoardFromJson,
} from "@/lib/league-json";
import type {
  FranchiseDetailView,
  FranchiseView,
  KeeperBoardView,
  TradeBoardView,
} from "@/lib/league-view";

/**
 * Where the franchise, keeper, and trade surfaces get their data.
 *
 * The contract, the same one the draft board runs on: read the database when
 * there is one, read the snapshots in `data/` when there is not, and never let
 * the database being unreachable take a page down. The snapshots are the
 * Saturday guarantee.
 *
 * A database read that throws falls back to JSON and logs, rather than
 * surfacing a 500. That matters more than it looks: these pages are load-
 * bearing on draft day, and a network blip on a Supabase call must not be the
 * reason the room cannot see who owns a pick.
 */

/** Set when the last read fell back. Surfaced in the UI so it is never silent. */
export type SourceNote = {
  fromDatabase: boolean;
  /** Present only when a database read was attempted and failed. */
  fallbackReason: string | null;
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fromDatabaseOrJson<T extends { fromDatabase: boolean }>(
  surface: string,
  readDb: () => Promise<T>,
  readJson: () => T,
): Promise<T & { fallbackReason: string | null }> {
  if (hasDatabase()) {
    try {
      const view = await readDb();
      return { ...view, fallbackReason: null };
    } catch (error) {
      const reason = describe(error);
      console.error(
        `[league-source] ${surface}: database read failed, falling back to the ` +
          `snapshots in data/. ${reason}`,
      );
      return { ...readJson(), fallbackReason: reason };
    }
  }
  return { ...readJson(), fallbackReason: null };
}

export async function getFranchises(): Promise<{
  franchises: FranchiseView[];
  source: SourceNote;
}> {
  if (hasDatabase()) {
    try {
      const { getFranchisesFromDb } = await import("@/lib/league-db");
      const franchises = await getFranchisesFromDb();
      // An empty database is a database that has not been seeded yet, which is
      // not a reason to show the commissioner nothing.
      if (franchises.length) {
        return { franchises, source: { fromDatabase: true, fallbackReason: null } };
      }
      return {
        franchises: getFranchisesFromJson(),
        source: {
          fromDatabase: false,
          fallbackReason: "The database has no franchises yet — run the seed.",
        },
      };
    } catch (error) {
      const reason = describe(error);
      console.error(`[league-source] franchises: ${reason}`);
      return {
        franchises: getFranchisesFromJson(),
        source: { fromDatabase: false, fallbackReason: reason },
      };
    }
  }
  return {
    franchises: getFranchisesFromJson(),
    source: { fromDatabase: false, fallbackReason: null },
  };
}

export async function getFranchiseDetail(
  id: string,
): Promise<{ franchise: FranchiseDetailView | null; source: SourceNote }> {
  if (hasDatabase()) {
    try {
      const { getFranchiseDetailFromDb } = await import("@/lib/league-db");
      const franchise = await getFranchiseDetailFromDb(id);
      if (franchise) {
        return { franchise, source: { fromDatabase: true, fallbackReason: null } };
      }
    } catch (error) {
      const reason = describe(error);
      console.error(`[league-source] franchise ${id}: ${reason}`);
      return {
        franchise: getFranchiseDetailFromJson(id),
        source: { fromDatabase: false, fallbackReason: reason },
      };
    }
  }
  return {
    franchise: getFranchiseDetailFromJson(id),
    source: { fromDatabase: false, fallbackReason: null },
  };
}

export async function getKeeperBoard(): Promise<
  KeeperBoardView & { fallbackReason: string | null }
> {
  return fromDatabaseOrJson(
    "keepers",
    async () => {
      const { getKeeperBoardFromDb } = await import("@/lib/league-db");
      const view = await getKeeperBoardFromDb();
      if (!view.keepers.length && !view.pending.length) {
        throw new Error("The database has no keeper data yet — run the seed.");
      }
      return view;
    },
    getKeeperBoardFromJson,
  );
}

export async function getTradeBoard(): Promise<
  TradeBoardView & { fallbackReason: string | null }
> {
  return fromDatabaseOrJson(
    "trades",
    async () => {
      const { getTradeBoardFromDb } = await import("@/lib/league-db");
      const view = await getTradeBoardFromDb();
      if (!view.ledger.length) {
        throw new Error("The database has no franchises yet — run the seed.");
      }
      return view;
    },
    getTradeBoardFromJson,
  );
}
