/**
 * Legacy name: this repository’s lending “pool” is the **Confidential Lending Desk**
 * (`confidential_desk` program), not the separate Haven `initialize_pool` program.
 *
 * Use the desk initialization flow instead:
 *
 *   yarn init-desk-devnet              # base: initialize_desk
 *   yarn init-desk-vaults-er-devnet    # ER: init_desk_vaults
 *   yarn activate-desk-ledger-er-devnet # authority: delegate desk_ledger
 *
 * If you need the legacy Haven AMM pool, run `init-pool-devnet` from the **haven** crate
 * (it uses `haven.json` + `initializePool`).
 */

console.error(`
init-pool-devnet.cjs — not used for confidential-desk.

Run for this program:
  yarn init-desk-devnet
  yarn init-desk-vaults-er-devnet
  yarn activate-desk-ledger-er-devnet

See scripts/README.md
`);
process.exit(1);
