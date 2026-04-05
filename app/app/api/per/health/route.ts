import { NextResponse } from "next/server";
import { perFetchJson } from "@/lib/per-client";

export async function GET() {
  try {
    const health = await perFetchJson<{ status: string }>("/health");
    return NextResponse.json(health);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
