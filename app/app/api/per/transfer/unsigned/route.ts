import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  getPerCluster,
  getPerMint,
  perFetchJson,
  type UnsignedTxResponse,
} from "@/lib/per-client";

/**
 * Build an unsigned tx for private PER→PER SPL transfer (ephemeral_spl_token path).
 * @see ephemeral-spl-token/api — POST /v1/spl/transfer
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      from?: string;
      to?: string;
      amount?: number;
      mint?: string;
    };

    const fromStr = body.from?.trim();
    const toStr = body.to?.trim();
    if (!fromStr || !toStr) {
      return NextResponse.json(
        { error: "Body must include from and to (owner pubkeys, base58)" },
        { status: 400 },
      );
    }

    let fromPk: PublicKey;
    let toPk: PublicKey;
    try {
      fromPk = new PublicKey(fromStr);
      toPk = new PublicKey(toStr);
    } catch {
      return NextResponse.json(
        { error: "Invalid from or to pubkey" },
        { status: 400 },
      );
    }

    if (fromPk.equals(toPk)) {
      return NextResponse.json(
        { error: "Recipient must differ from sender" },
        { status: 400 },
      );
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

    const transferBody = {
      from: fromPk.toBase58(),
      to: toPk.toBase58(),
      mint,
      amount,
      cluster,
      visibility: "private" as const,
      fromBalance: "ephemeral" as const,
      toBalance: "ephemeral" as const,
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: true,
    };

    const unsigned = await perFetchJson<UnsignedTxResponse>(
      "/v1/spl/transfer",
      {
        method: "POST",
        body: JSON.stringify(transferBody),
      },
    );

    return NextResponse.json(unsigned);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
