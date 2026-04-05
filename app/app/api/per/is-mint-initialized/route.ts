import { NextResponse } from "next/server";
import { getPerCluster, getPerMint, perFetchJson, queryString } from "@/lib/per-client";

export async function GET() {
  try {
    const mint = getPerMint();
    const cluster = getPerCluster();
    const q = queryString({ mint, cluster });
    const data = await perFetchJson<{
      mint: string;
      initialized: boolean;
      validator: string;
      transferQueue: string;
    }>(`/v1/spl/is-mint-initialized?${q}`);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
