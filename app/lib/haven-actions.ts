/**
 * Shared helpers for the confidential desk UI (rollup tx + LTV math).
 * Legacy Haven pool flows were removed — use `desk-actions` for lending.
 */

import type { BN } from "@coral-xyz/anchor";

export {
  isUserRejectedError,
  sendSignedEphemeralTx,
  confirmErTransactionSucceeded,
} from "@/lib/desk-rollup";

export {
  maxBorrowForCollateral,
  minCollateralForBorrowRaw,
  maxIncrementalBorrowAllowed,
} from "@/lib/desk-math";

/** On-chain borrower position fields (PER). */
export interface PositionData {
  collateralAmount: BN;
  debtAmount: BN;
  lastAccrualTs: BN;
  isLiquidatable: boolean;
}
