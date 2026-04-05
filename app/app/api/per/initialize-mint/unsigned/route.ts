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
    const body = (await req.json()) as { payer?: string; mint?: string };
    const payerStr = body.payer?.trim();
    if (!payerStr) {
      return NextResponse.json(
        { error: "Body must include payer (base58 pubkey)" },
        { status: 400 },
      );
    }
    let payerPk: PublicKey;
    try {
      payerPk = new PublicKey(payerStr);
    } catch {
      return NextResponse.json({ error: "Invalid payer pubkey" }, { status: 400 });
    }

    const cluster = getPerCluster();
    const mint = body.mint?.trim() || getPerMint();

    const initBody = {
      payer: payerPk.toBase58(),
      mint,
      cluster,
    };

    const unsigned = await perFetchJson<UnsignedTxResponse>(
      "/v1/spl/initialize-mint",
      {
        method: "POST",
        body: JSON.stringify(initBody),
      },
    );

    return NextResponse.json(unsigned);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
