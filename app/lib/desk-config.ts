import { PublicKey } from "@solana/web3.js";

import deskIdl from "@/lib/confidential_desk.json";
import {
  ephemeralRollupNeedsSignMessageAuth,
  getBorrowMint,
  getCollateralMint,
  isPublicDevnetEphemeralRollup,
  isStrictTeeEphemeralRollup,
  resolveDelegateValidatorPk,
  WSOL_MINT,
} from "@/lib/haven-config";

export {
  ephemeralRollupNeedsSignMessageAuth,
  isPublicDevnetEphemeralRollup,
  isStrictTeeEphemeralRollup,
  resolveDelegateValidatorPk,
  WSOL_MINT,
};

const DESK_SEED = Buffer.from("desk");
const BORROWER_SEED = Buffer.from("borrower");
const LENDER_SEED = Buffer.from("lender");
const LP_MINT_SEED = Buffer.from("lp_mint");
const LEDGER_SEED = Buffer.from("ledger");

/** Matches `app/lib/confidential_desk.json` / `anchor build` output (override via env). */
export const DEFAULT_CONFIDENTIAL_DESK_PROGRAM_ID = new PublicKey(
  (deskIdl as { address: string }).address,
);

export function getDeskProgramId(): PublicKey {
  const s = process.env.NEXT_PUBLIC_CONFIDENTIAL_DESK_PROGRAM_ID?.trim();
  if (s) return new PublicKey(s);
  return DEFAULT_CONFIDENTIAL_DESK_PROGRAM_ID;
}

export function deriveDeskPda(
  programId: PublicKey,
  collateralMint: PublicKey,
  borrowMint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [DESK_SEED, collateralMint.toBuffer(), borrowMint.toBuffer()],
    programId,
  );
  return pda;
}

/** PER-side pool accounting PDA (seed `ledger` + desk). */
export function deriveDeskLedgerPda(programId: PublicKey, desk: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [LEDGER_SEED, desk.toBuffer()],
    programId,
  );
  return pda;
}

export function deriveBorrowerPositionPda(
  programId: PublicKey,
  desk: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [BORROWER_SEED, desk.toBuffer(), owner.toBuffer()],
    programId,
  );
  return pda;
}

export function deriveLenderPositionPda(
  programId: PublicKey,
  desk: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [LENDER_SEED, desk.toBuffer(), owner.toBuffer()],
    programId,
  );
  return pda;
}

export function deriveLpMintPda(
  programId: PublicKey,
  collateralMint: PublicKey,
  borrowMint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [LP_MINT_SEED, collateralMint.toBuffer(), borrowMint.toBuffer()],
    programId,
  );
  return pda;
}

export function deskContext() {
  const collateralMint = getCollateralMint();
  const borrowMint = getBorrowMint();
  const programId = getDeskProgramId();
  const deskPda = deriveDeskPda(programId, collateralMint, borrowMint);
  const deskLedgerPda = deriveDeskLedgerPda(programId, deskPda);
  const lpMintPda = deriveLpMintPda(programId, collateralMint, borrowMint);
  return { collateralMint, borrowMint, programId, deskPda, deskLedgerPda, lpMintPda };
}
