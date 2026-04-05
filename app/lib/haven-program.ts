import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";

import rawIdl from "@/lib/haven.json";

export function createHavenProgram(
  connection: Connection,
  wallet: AnchorWallet,
): Program {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    skipPreflight: true,
  });
  return new Program(rawIdl as Idl, provider);
}
