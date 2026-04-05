# Confidential desk — operator scripts

All commands assume:

```bash
cd confidential-desk
yarn install
anchor build && yarn sync-idl-desk
```

Default wallet: `ANCHOR_WALLET` or `~/.config/solana/id.json`.  
Default base RPC: `ANCHOR_PROVIDER_URL` or `https://api.devnet.solana.com`.

## Recommended order (devnet)

| Step | Command | Who | What |
|------|---------|-----|------|
| 1 | `yarn init-desk-devnet` | Authority | `initialize_desk` on Solana (desk, LP mint, ledger, permissions). Vault addresses are stored; ATAs are not created on base. |
| 2 | `yarn init-desk-vaults-er-devnet` | Anyone with SOL on ER | `init_desk_vaults` on the Ephemeral Rollup — creates protocol vault ATAs. |
| 3 | `yarn activate-desk-ledger-er-devnet` | **Desk authority only** | Delegates `desk_ledger` to the ER so lenders/borrowers can mutate ledger on PER. |

Optional:

| Command | Purpose |
|---------|---------|
| `yarn update-oracle-devnet` | Authority updates `collateral_price_q12` (set `PRICE_Q12`). |

## Environment overrides

- **Mint pair** (must match everywhere): `COLLATERAL_MINT`, `BORROW_MINT` (base58). Defaults: WSOL + Circle devnet USDC.
- **Risk params** (init only): `INTEREST_BPS`, `LTV_MAX_BPS`, `LIQ_THRESHOLD_BPS`, `LIQ_BONUS_BPS`, `PRICE_Q12`.
- **ER endpoint** (vault script): `EPHEMERAL_RPC` or `NEXT_PUBLIC_PER_EPHEMERAL_RPC` (default `https://devnet-as.magicblock.app`).
- **TEE rollup**: `EPHEMERAL_USE_TEE_AUTH=1` for `init-desk-vaults-er-devnet` (uses keypair `sign` for `getAuthToken`).
- **Delegate validator**: `EPHEMERAL_VALIDATOR`, `EPHEMERAL_HTTP`, `MAGIC_ROUTER_*` — see `activate-desk-ledger-er-devnet.cjs` header.

## Localnet

Point `ANCHOR_PROVIDER_URL` at your validator (e.g. `http://127.0.0.1:8899`), deploy the program, then run the same scripts. For ER steps you need a reachable ER RPC that serves your deployment (often local MagicBlock tooling).

## Legacy

- `init-pool-devnet.cjs` — exits with instructions; that flow targets the **Haven** program, not `confidential_desk`.
