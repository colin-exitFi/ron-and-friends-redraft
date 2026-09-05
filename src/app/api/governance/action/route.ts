import { NextResponse } from "next/server";

import { deleteAction, recordAction } from "@/lib/governance";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      season?: number;
      type?: string;
      description?: string | null;
      disclosureNote?: string | null;
    };
    if (!body.type) {
      return NextResponse.json({ error: "type required." }, { status: 400 });
    }
    const view = await recordAction({
      season: body.season,
      type: body.type,
      description: body.description ?? null,
      disclosureNote: body.disclosureNote ?? null,
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
    const view = await deleteAction(id);
    return NextResponse.json({ governance: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
