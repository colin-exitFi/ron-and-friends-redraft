import { NextResponse } from "next/server";

import { castVote, clearVote } from "@/lib/governance";
import type { VoteChoice } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      motionId?: string;
      teamId?: string;
      choice?: VoteChoice;
    };
    if (!body.motionId || !body.teamId || !body.choice) {
      return NextResponse.json(
        { error: "motionId, teamId, choice required." },
        { status: 400 },
      );
    }
    const view = await castVote({
      motionId: body.motionId,
      teamId: body.teamId,
      choice: body.choice,
    });
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const motionId = url.searchParams.get("motionId");
    const teamId = url.searchParams.get("teamId");
    if (!motionId || !teamId) {
      return NextResponse.json({ error: "motionId and teamId required." }, { status: 400 });
    }
    const view = await clearVote({ motionId, teamId });
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
