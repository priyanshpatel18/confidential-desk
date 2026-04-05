# Private Lending Desk

Confidential lending on Solana: **desk config + oracle** on the base layer; **liquidity, collateral, debt, and LP** on MagicBlock Ephemeral Rollups using **ephemeral SPL** transfers. **Shielding** uses the MagicBlock **Private Payments API** (see `app/app/api/per/*` and `app/lib/per-*.ts`).

There is **no settlement ticket / commit pattern** — lending ops are single PER transactions.

## Stack

- Anchor **0.32.1**, `ephemeral-rollups-sdk` **0.8.8** (`#[ephemeral]`, `#[delegate]`, access-control CPIs, `commit_and_undelegate_accounts` for close)
- Next.js app: `@/lib/desk-actions.ts` (activate + PER flows), Payflow-style PER proxy routes

## Build

```bash
anchor build
```

## Frontend (`confidential-desk/app`)

1. Copy `app/.env.example` → `app/.env.local` and set `PER_*` / `NEXT_PUBLIC_PER_*` for Payments API + rollup RPCs.
2. Sync IDL after each `anchor build`:

```bash
cd app && npm run sync-idl-desk
```

3. **Initialize the desk** (base layer) and **rollup vaults** — see [`scripts/README.md`](scripts/README.md):

   ```bash
   yarn init-desk-devnet
   yarn init-desk-vaults-er-devnet
   yarn activate-desk-ledger-er-devnet   # desk authority only
   ```

4. Optional: `yarn update-oracle-devnet` (authority) to set `PRICE_Q12`.

### User flow

1. **Shield** base SPL → PER (`/api/per/deposit/unsigned` + wallet sign).
2. **Activate** borrower or lender on base (`open_*` + delegate permission + `delegate_*`).
3. **Lend / borrow** on PER (`deposit_liquidity`, `deposit_collateral`, `borrow`, `repay`, etc.) — one instruction per tx.
4. **Unshield** when done (`/api/per/withdraw/unsigned`).

### Rollup SPL balance (what the desk actually spends)

Desk instructions use **normal SPL Token `transfer` / `burn`** from the user’s **Associated Token Account** on the rollup (same address as on Solana base for `(mint, owner)`). They do **not** CPI into `ephemeral_spl_token`. After shielding, funds must appear in that rollup SPL ATA (what the Private Payments API reports as ephemeral/private balance for the mint).

- **On-chain:** `deposit_liquidity`, `deposit_collateral`, `repay`, and `withdraw_lp` assert sufficient SPL balance in the relevant ATA before CPI and fail with **`InsufficientRollupSplAta`** (custom Anchor error) instead of relying only on the SPL program’s insufficient-funds path.
- **Client:** `desk-actions.ts` preflight-checks the same balances before submitting PER txs.

Integration tests: `tests/confidential-desk.ts` → describe **“insufficient rollup SPL ATA (on-chain guard)”**.

## Tests

```bash
anchor build
anchor test
```

Integration tests: `tests/confidential-desk.ts`, helpers `tests/desk-test-utils.ts`. `Anchor.toml` clones the MagicBlock **Permission** program from devnet for local `open_borrower` / `open_lender`.

**TEE privacy:** `tests/confidential-desk-tee.ts` (skipped unless `EPHEMERAL_TEE_INTEGRATION=1`).

## Env reference (app)

| Variable | Purpose |
|----------|---------|
| `PER_API_BASE`, `PER_CLUSTER`, `PER_MINT` | Server → Payments API |
| `NEXT_PUBLIC_PER_BASE_RPC`, `NEXT_PUBLIC_PER_EPHEMERAL_RPC` | Wallet tx submit targets |
| `NEXT_PUBLIC_PER_USE_TEE_AUTH` | `1` when rollup requires `signMessage` |
| `NEXT_PUBLIC_EPHEMERAL_*` | Fallback rollup URL if PER RPC unset |
| `NEXT_PUBLIC_CONFIDENTIAL_DESK_PROGRAM_ID` | Optional program id override |
