import { NextRequest, NextResponse } from "next/server";
import {
  getPerCluster,
  getPerMint,
  perFetchJson,
  queryString,
} from "@/lib/per-client";

/** GET ?address=...&location=base|ephemeral&mint=&cluster= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    const location = searchParams.get("location") ?? "base";
    const mint = searchParams.get("mint") ?? getPerMint();
    const cluster = (searchParams.get("cluster") ?? getPerCluster()) as
      | "devnet"
      | "mainnet";

    if (!address) {
      return NextResponse.json(
        { error: "Missing query: address" },
        { status: 400 },
      );
    }
    if (location !== "base" && location !== "ephemeral") {
      return NextResponse.json(
        { error: "location must be base or ephemeral" },
        { status: 400 },
      );
    }

    const qs = queryString({ address, mint, cluster });
    const path =
      location === "base"
        ? `/v1/spl/balance?${qs}`
        : `/v1/spl/private-balance?${qs}`;

    const data = await perFetchJson<Record<string, unknown>>(path);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
