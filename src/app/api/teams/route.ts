import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { LEAGUE } from "@/lib/league-config";

export const runtime = "nodejs";

/**
 * Franchise admin.
 *
 * Three names per franchise and they are not interchangeable: `shortName` is the
 * handle the Smart Draft room uses and the key everything joins on,
 * `franchiseName` is the real ESPN name, `manager` is the human. See the comment
 * on `public.teams` in the migrations.
 */
type TeamInput = {
  id?: string;
  shortName?: string;
  franchiseName?: string;
  manager?: string;
  abbrev?: string | null;
  draftSlot?: number | null;
  /**
   * Close or re-open this franchise's keeper declarations. Closing says the
   * list is FINAL, so any unfilled slot is a deliberate pass rather than an
   * outstanding answer — which is the difference /keepers draws between
   * "chase this manager" and "settled".
   */
  keeperDeclarationsClosed?: boolean;
};

function cleanSlot(slot: number | null | undefined): number | null {
  if (slot == null || Number.isNaN(slot)) return null;
  if (slot < 1 || slot > LEAGUE.teams) return null;
  return Math.trunc(slot);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamInput;
    const shortName = (body.shortName ?? "").trim();
    const franchiseName = (body.franchiseName ?? "").trim();
    const manager = (body.manager ?? "").trim();

    if (!shortName || !franchiseName || !manager) {
      return NextResponse.json(
        {
          error:
            "Short name, franchise name, and manager are all required. The short " +
            "name is the handle the draft room uses (e.g. “Greg”).",
        },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("teams")
      .insert({
        short_name: shortName,
        franchise_name: franchiseName,
        manager,
        abbrev: body.abbrev?.trim() || null,
        draft_slot: cleanSlot(body.draftSlot),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ team: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as TeamInput;
    if (!body.id) {
      return NextResponse.json({ error: "Missing team id." }, { status: 400 });
    }

    const patch: {
      short_name?: string;
      franchise_name?: string;
      manager?: string;
      abbrev?: string | null;
      draft_slot?: number | null;
      keeper_declarations_closed_at?: string | null;
      updated_at?: string;
    } = { updated_at: new Date().toISOString() };

    if (body.shortName !== undefined) patch.short_name = body.shortName.trim();
    if (body.franchiseName !== undefined) patch.franchise_name = body.franchiseName.trim();
    if (body.manager !== undefined) patch.manager = body.manager.trim();
    if (body.abbrev !== undefined) patch.abbrev = body.abbrev?.trim() || null;
    if (body.draftSlot !== undefined) patch.draft_slot = cleanSlot(body.draftSlot);
    if (body.keeperDeclarationsClosed !== undefined) {
      patch.keeper_declarations_closed_at = body.keeperDeclarationsClosed
        ? new Date().toISOString()
        : null;
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("teams")
      .update(patch)
      .eq("id", body.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ team: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing team id." }, { status: 400 });
    }
    const supabase = createServiceClient();
    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
