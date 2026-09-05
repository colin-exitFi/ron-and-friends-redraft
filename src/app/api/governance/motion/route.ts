import { NextResponse } from "next/server";

import { createMotion, deleteMotion, updateMotion } from "@/lib/governance";
import type { MotionStatus, MotionThreshold } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      season?: number;
      type?: string;
      threshold?: MotionThreshold;
      proposerTeam?: string | null;
      documentation?: string | null;
    };
    if (!body.type || !body.threshold) {
      return NextResponse.json({ error: "type and threshold required." }, { status: 400 });
    }
    const view = await createMotion({
      season: body.season,
      type: body.type,
      threshold: body.threshold,
      proposerTeam: body.proposerTeam ?? null,
      documentation: body.documentation ?? null,
    });
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      motionId?: string;
      status?: MotionStatus;
      secondedByTeam?: string | null;
    };
    if (!body.motionId) {
      return NextResponse.json({ error: "motionId required." }, { status: 400 });
    }
    const view = await updateMotion({
      motionId: body.motionId,
      status: body.status,
      secondedByTeam: body.secondedByTeam,
    });
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
    const view = await deleteMotion(id);
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
