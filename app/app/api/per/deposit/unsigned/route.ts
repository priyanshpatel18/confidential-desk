import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  getPerCluster,
  getPerMint,
  perFetchJson,
  type UnsignedTxResponse,
} from "@/lib/per-client";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      amount?: number;
      mint?: string;
    };
    const ownerStr = body.owner?.trim();
    if (!ownerStr) {
      return NextResponse.json(
        { error: "Body must include owner (signer base58 pubkey)" },
        { status: 400 },
      );
    }
    let ownerPk: PublicKey;
    try {
      ownerPk = new PublicKey(ownerStr);
    } catch {
      return NextResponse.json({ error: "Invalid owner pubkey" }, { status: 400 });
    }

    const amount = body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 1) {
      return NextResponse.json(
        { error: "Body must include amount (integer >= 1)" },
        { status: 400 },
      );
    }

    const cluster = getPerCluster();
    const mint = body.mint?.trim() || getPerMint();

    const depositBody = {
      owner: ownerPk.toBase58(),
      amount,
      cluster,
      mint,
      initIfMissing: true,
      initVaultIfMissing: true,
      initAtasIfMissing: true,
      idempotent: true,
    };

    const unsigned = await perFetchJson<UnsignedTxResponse>(
      "/v1/spl/deposit",
      {
        method: "POST",
        body: JSON.stringify(depositBody),
      },
    );

    return NextResponse.json(unsigned);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
