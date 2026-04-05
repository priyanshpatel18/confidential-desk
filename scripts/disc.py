import hashlib
for name in [
    "delegate_desk_ledger",
    "deposit_liquidity_base",
    "approve_borrow",
    "sync_repayment",
    "sync_lender_deposit",
    "approve_lp_withdrawal",
    "liquidate_per",
    "initialize_desk",
]:
    d = hashlib.sha256(f"global:{name}".encode()).digest()[:8]
    print(name, list(d))
