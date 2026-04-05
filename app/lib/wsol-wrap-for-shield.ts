import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

/**
 * Instructions to move `lamportsToWrap` from `owner` native SOL into their WSOL ATA
 * (create ATA if missing, transfer lamports, sync_native). Prepends a PER deposit on base.
 */
export async function buildWrapNativeSolIntoWsolInstructions(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  lamportsToWrap: bigint,
): Promise<TransactionInstruction[]> {
  if (lamportsToWrap <= BigInt(0)) {
    return [];
  }
  if (lamportsToWrap > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Wrap amount too large for this client.");
  }
  const lamports = Number(lamportsToWrap);
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  const ixs: TransactionInstruction[] = [];
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    ixs.push(
      createAssociatedTokenAccountInstruction(payer, ata, owner, NATIVE_MINT),
    );
  }
  ixs.push(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: ata,
      lamports,
    }),
  );
  ixs.push(createSyncNativeInstruction(ata, TOKEN_PROGRAM_ID));
  return ixs;
}
