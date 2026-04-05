import { BN } from "@coral-xyz/anchor";

const Q12 = new BN(1_000_000_000_000);

export function maxBorrowForCollateral(
  collateralRaw: BN,
  collateralPriceQ12: BN,
  ltvMaxBps: number,
): BN {
  const cv = collateralRaw.mul(collateralPriceQ12).div(Q12);
  return cv.mul(new BN(ltvMaxBps)).div(new BN(10_000));
}

/** Smallest collateral (raw atoms) so LTV allows at least borrowRaw new debt (ceiling). */
export function minCollateralForBorrowRaw(
  borrowRaw: BN,
  collateralPriceQ12: BN,
  ltvMaxBps: number,
): BN {
  if (borrowRaw.isZero()) return new BN(0);
  const ltv = new BN(ltvMaxBps);
  const num = borrowRaw.mul(Q12).mul(new BN(10_000));
  const den = collateralPriceQ12.mul(ltv);
  if (den.isZero()) return new BN(0);
  const q = num.div(den);
  const rem = num.mod(den);
  return rem.isZero() ? q : q.addn(1);
}

function bnMin(a: BN, b: BN): BN {
  return a.lt(b) ? a : b;
}

/**
 * Additional borrow allowed: min(LTV headroom after existing debt, vault liquidity).
 */
export function maxIncrementalBorrowAllowed(
  collateralRaw: BN,
  collateralPriceQ12: BN,
  ltvMaxBps: number,
  existingDebtRaw: BN,
  vaultLiquidityRaw: BN,
): BN {
  const ltvCap = maxBorrowForCollateral(
    collateralRaw,
    collateralPriceQ12,
    ltvMaxBps,
  );
  const headroom = ltvCap.sub(existingDebtRaw);
  const h = headroom.gt(new BN(0)) ? headroom : new BN(0);
  return bnMin(h, vaultLiquidityRaw);
}
