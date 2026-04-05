/**
 * MagicBlock ER: AnchorProvider leaves legacy Transaction without
 * lastValidBlockHeight, so confirmTransaction can fail; failed confirms then hit
 * Anchor's `new SendTransactionError(string, logs)` which breaks web3.js ≥1.88
 * (object-only constructor → "Unknown action 'undefined'").
 */

/**
 * @param {import("@solana/web3.js").Connection} connection
 * @param {import("@solana/web3.js").Transaction} tx
 * @param {import("@coral-xyz/anchor").Wallet} wallet
 * @param {{ commitment?: string }} [opts]
 * @returns {Promise<string>} signature
 */
async function sendAndConfirmLegacyTransaction(connection, tx, wallet, opts = {}) {
  const commitment = opts.commitment || "processed";
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);

  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    },
    commitment,
  );

  const st = await connection.getSignatureStatuses([sig], {
    searchTransactionHistory: true,
  });
  const v = st.value[0];
  if (v?.err) {
    throw new Error(
      `On-chain error: ${JSON.stringify(v.err)} (signature ${sig})`,
    );
  }

  return sig;
}

module.exports = { sendAndConfirmLegacyTransaction };
