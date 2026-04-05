"use client";

import { BN } from "@coral-xyz/anchor";
import {
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import rawIdl from "@/lib/confidential_desk.json";
import {
  activatePosition,
  borrow,
  closePosition,
  computeLpMintedForDeposit,
  depositCollateral,
  depositLiquidity,
  fetchDeskPositionData,
  fetchDeskSnapshotReadOnly,
  fetchDeskSummary,
  fetchLenderPositionData,
  initDeskVaults,
  isDeskDeployed,
  isDeskLedgerDelegated,
  repay,
  withdrawCollateral,
  withdrawLp,
  type DeskSummary,
  type LenderPositionData,
  type PositionData,
} from "@/lib/desk-actions";
import {
  deriveBorrowerPositionPda,
  deriveDeskLedgerPda,
  deriveDeskPda,
  deriveLenderPositionPda,
  getDeskProgramId,
} from "@/lib/desk-config";
import { createDeskProgram } from "@/lib/desk-program";
import { getEphemeralConnectionForBorrow } from "@/lib/ephemeral-connection";
import {
  humanTokenToRaw,
  parseRawBalanceIntString,
  rawToHuman,
  sanitizeDecimalInput,
  SOL_DECIMALS,
  USDC_DECIMALS,
} from "@/lib/format-shield-amounts";
import {
  bnMax,
  bnMin,
  coercePerBalance,
  formatNativeSol,
  formatRaw,
  friendlyTxError,
  getWsolLamportsOnBase,
  initialPortfolio,
  spendableNativeSolRaw,
  toRawAmount,
  type Portfolio,
} from "@/lib/haven-desk-helpers";
import {
  isUserRejectedError,
  maxIncrementalBorrowAllowed,
  minCollateralForBorrowRaw,
} from "@/lib/haven-actions";
import { borrowLogError } from "@/lib/haven-borrow-debug";
import {
  getBorrowMint,
  getCollateralMint,
  getSolanaCluster,
  inferWsFromHttp,
  pairLabels,
} from "@/lib/haven-config";
import {
  getPublicBaseRpc,
  getPublicEphemeralRpc,
  getPublicUseTeeAuth,
} from "@/lib/per-public";
import type { UnsignedTxResponse } from "@/lib/per-types";
import {
  submitPerTransactionMerged,
  submitPreparedPerTransaction,
} from "@/lib/per-wallet-submit";
import { buildWrapNativeSolIntoWsolInstructions } from "@/lib/wsol-wrap-for-shield";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

export function useConfidentialLendingDesk() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { publicKey, signTransaction, signMessage, connected } = wallet;

  const [mainTab, setMainTab] = useState<
    "shield" | "privateSend" | "lend" | "borrow"
  >("shield");
  const [portfolio, setPortfolio] = useState<Portfolio>(initialPortfolio);
  const [shieldMode, setShieldMode] = useState<"shield" | "unshield">("shield");
  const [shieldAsset, setShieldAsset] = useState<"sol" | "usdc">("usdc");
  const [perFlowAmount, setPerFlowAmount] = useState("");
  const [privateSendAsset, setPrivateSendAsset] = useState<"sol" | "usdc">(
    "usdc",
  );
  const [privateSendAmount, setPrivateSendAmount] = useState("");
  /** Recipient wallet (base58) for PER private send (shielded → shielded on rollup). */
  const [privateSendTo, setPrivateSendTo] = useState("");
  const [lendAmount, setLendAmount] = useState("");
  const [withdrawLpIn, setWithdrawLpIn] = useState("");
  const [withdrawColIn, setWithdrawColIn] = useState("");
  const [repayIn, setRepayIn] = useState("");
  const [borrowWantIn, setBorrowWantIn] = useState("");
  const [depositColIn, setDepositColIn] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unwrapWsolBusy, setUnwrapWsolBusy] = useState(false);
  const [deskReady, setDeskReady] = useState<boolean | null>(null);
  const [borrowerNeedsActivate, setBorrowerNeedsActivate] = useState(false);
  const [lenderNeedsActivate, setLenderNeedsActivate] = useState(false);
  const [ledgerDelegated, setLedgerDelegated] = useState(false);

  const programId = useMemo(() => getDeskProgramId(), []);
  const colMintKey = getCollateralMint().toBase58();
  const borMintKey = getBorrowMint().toBase58();

  const deskPda = useMemo(
    () =>
      deriveDeskPda(
        programId,
        new PublicKey(colMintKey),
        new PublicKey(borMintKey),
      ),
    [programId, colMintKey, borMintKey],
  );
  const deskLedgerPda = useMemo(
    () => deriveDeskLedgerPda(programId, deskPda),
    [programId, deskPda],
  );

  const walletPk = publicKey?.toBase58() ?? "";
  const connectionRef = useRef(connection);
  const anchorWalletRef = useRef(anchorWallet);
  const deskPdaRef = useRef(deskPda);
  const deskOnlineRef = useRef(false);
  const walletPkRef = useRef(walletPk);
  const connectedRef = useRef(connected);
  const colMintKeyRef = useRef(colMintKey);
  const borMintKeyRef = useRef(borMintKey);
  const rpcEndpointRef = useRef(connection.rpcEndpoint);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);
  useEffect(() => {
    anchorWalletRef.current = anchorWallet;
  }, [anchorWallet]);
  useEffect(() => {
    deskPdaRef.current = deskPda;
  }, [deskPda]);

  walletPkRef.current = walletPk;
  connectedRef.current = connected;
  colMintKeyRef.current = colMintKey;
  borMintKeyRef.current = borMintKey;
  rpcEndpointRef.current = connection.rpcEndpoint;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await isDeskDeployed(connectionRef.current, deskPdaRef.current);
        if (alive) setDeskReady(ok);
      } catch {
        if (alive) setDeskReady(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [connection.rpcEndpoint, deskPda.toBase58()]);

  const deskOnline = deskReady === true;
  useEffect(() => {
    deskOnlineRef.current = deskOnline;
  }, [deskOnline]);

  const signMessageSafe = useCallback(
    async (message: Uint8Array) => {
      if (!signMessage) {
        throw new Error("Your wallet cannot sign messages. Try Phantom.");
      }
      return signMessage(message);
    },
    [signMessage],
  );

  const getErConn = useCallback(async () => {
    if (!publicKey || !anchorWallet) throw new Error("Connect wallet");
    const http = getPublicEphemeralRpc();
    const ws = inferWsFromHttp(http);
    return getEphemeralConnectionForBorrow(
      http,
      ws,
      publicKey,
      signMessageSafe,
    );
  }, [publicKey, anchorWallet, signMessageSafe]);

  const refreshBalances = useCallback(async () => {
    const conn = connectionRef.current;
    const aw = anchorWalletRef.current;
    const online = deskOnlineRef.current;
    const isConnected = connectedRef.current;
    const pk = walletPkRef.current;
    const colKey = colMintKeyRef.current;
    const borKey = borMintKeyRef.current;

    let deskSnap: DeskSummary | null = null;
    if (online) {
      try {
        let erConn: Connection | undefined;
        try {
          erConn = await getErConn();
        } catch {
          erConn = undefined;
        }
        deskSnap = await fetchDeskSnapshotReadOnly(
          conn,
          deskPdaRef.current,
          rawIdl,
          erConn,
        );
      } catch {
        deskSnap = await fetchDeskSnapshotReadOnly(
          conn,
          deskPdaRef.current,
          rawIdl,
        );
      }
    }

    const ledgerDel = await isDeskLedgerDelegated(conn, deskLedgerPda);
    setLedgerDelegated(ledgerDel);

    let shCol = "—";
    let shBor = "—";
    if (pk) {
      try {
        const [c, b] = await Promise.all([
          fetch(
            `/api/per/balance?address=${encodeURIComponent(pk)}&location=ephemeral&mint=${encodeURIComponent(colKey)}`,
          ).then((r) => r.json()),
          fetch(
            `/api/per/balance?address=${encodeURIComponent(pk)}&location=ephemeral&mint=${encodeURIComponent(borKey)}`,
          ).then((r) => r.json()),
        ]);
        shCol = c.error ? `Error` : coercePerBalance(c.balance);
        shBor = b.error ? `Error` : coercePerBalance(b.balance);
      } catch {
        shCol = "—";
        shBor = "—";
      }
    }

    if (!isConnected || !pk || !aw) {
      setPortfolio(() => ({
        ...initialPortfolio,
        shieldedCollateral: shCol,
        shieldedBorrow: shBor,
        deskSnapshot: deskSnap,
      }));
      setBorrowerNeedsActivate(false);
      setLenderNeedsActivate(false);
      return;
    }

    const ownerPk = new PublicKey(pk);
    const collateralMintPk = new PublicKey(colKey);
    const borrowMintPk = new PublicKey(borKey);
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");

    let nativeSol = "0";
    try {
      nativeSol = formatNativeSol(await conn.getBalance(ownerPk));
    } catch {
      nativeSol = "0";
    }

    let colDec = 9;
    let colBal = "0";
    try {
      const colMintInfo = await getMint(conn, collateralMintPk);
      colDec = colMintInfo.decimals;
      const colAta = getAssociatedTokenAddressSync(collateralMintPk, ownerPk);
      const r = await conn.getTokenAccountBalance(colAta);
      colBal = formatRaw(new BN(r.value.amount), colMintInfo.decimals);
    } catch {
      colBal = "0";
    }

    let borDec = 6;
    let borBal = "0";
    try {
      const borMintInfo = await getMint(conn, borrowMintPk);
      borDec = borMintInfo.decimals;
      const borAta = getAssociatedTokenAddressSync(borrowMintPk, ownerPk);
      const r = await conn.getTokenAccountBalance(borAta);
      borBal = formatRaw(new BN(r.value.amount), borMintInfo.decimals);
    } catch {
      borBal = "0";
    }

    let lpDec = 6;
    let lpBalStr = "0";
    let borrowedDisp = "0";
    let nextPos: PositionData | null = null;
    let nextLen: LenderPositionData | null = null;

    try {
      const deskSummary = await fetchDeskSummary(
        createDeskProgram(conn, aw),
        deskPdaRef.current,
      );
      const borMintInfo = await getMint(conn, borrowMintPk);
      const lpMintPk = deskSummary.lpMint;
      const lpInfo = await getMint(conn, lpMintPk);
      lpDec = lpInfo.decimals;
      const lpAta = getAssociatedTokenAddressSync(lpMintPk, ownerPk);
      try {
        const r = await conn.getTokenAccountBalance(lpAta);
        lpBalStr = formatRaw(new BN(r.value.amount), lpInfo.decimals);
      } catch {
        lpBalStr = "0";
      }
      borrowedDisp = formatRaw(
        new BN(deskSummary.totalBorrowed.toString()),
        borMintInfo.decimals,
      );
    } catch {
      lpBalStr = "0";
      borrowedDisp = "0";
    }

    try {
      let erConn: Connection | undefined;
      try {
        erConn = await getErConn();
      } catch {
        erConn = undefined;
      }
      if (erConn) {
        nextPos = await fetchDeskPositionData(erConn, aw, rawIdl);
        nextLen = await fetchLenderPositionData(erConn, aw, rawIdl);
      }
      if (!nextPos) nextPos = await fetchDeskPositionData(conn, aw, rawIdl);
      if (!nextLen) nextLen = await fetchLenderPositionData(conn, aw, rawIdl);
    } catch {
      /* ignore */
    }

    const borPda = deriveBorrowerPositionPda(programId, deskPdaRef.current, ownerPk);
    const lenPda = deriveLenderPositionPda(programId, deskPdaRef.current, ownerPk);
    const bInfo = await conn.getAccountInfo(borPda);
    const lInfo = await conn.getAccountInfo(lenPda);
    setBorrowerNeedsActivate(
      bInfo === null || !bInfo.owner.equals(DELEGATION_PROGRAM_ID),
    );
    setLenderNeedsActivate(
      lInfo === null || !lInfo.owner.equals(DELEGATION_PROGRAM_ID),
    );

    setPortfolio((prev) => ({
      ...prev,
      deskSnapshot: deskSnap,
      collateralDecimals: colDec,
      borrowDecimals: borDec,
      lpDecimals: lpDec,
      nativeSolBal: nativeSol,
      collateralBal: colBal,
      borrowBal: borBal,
      lpBal: lpBalStr,
      shieldedCollateral: shCol,
      shieldedBorrow: shBor,
      deskBorrowedDisplay: borrowedDisp,
      position: nextPos ?? prev.position,
      lender: nextLen ?? prev.lender,
    }));
  }, [deskLedgerPda, getErConn, programId]);

  useEffect(() => {
    void refreshBalances();
  }, [walletPk, deskPda, colMintKey, borMintKey, connected, connection.rpcEndpoint, deskOnline, refreshBalances]);

  useEffect(() => {
    setPerFlowAmount("");
  }, [shieldMode, shieldAsset]);

  useEffect(() => {
    setPrivateSendAmount("");
  }, [privateSendAsset]);

  const formDisabled = !connected || busy || !deskOnline;

  const runWithEr = async (
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> => {
    setErr(null);
    if (!anchorWallet || !signMessage) {
      setErr("Connect wallet with sign message support.");
      return;
    }
    setBusy(true);
    try {
      await fn();
      await refreshBalances();
    } catch (e) {
      borrowLogError(`[ui] ${label}`, e);
      setErr(friendlyTxError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  /** Base Solana only (e.g. `init_desk_vaults` — same layer as RPS delegate flow). */
  const runWithBase = async (
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> => {
    setErr(null);
    if (!anchorWallet) {
      setErr("Connect wallet.");
      return;
    }
    setBusy(true);
    try {
      await fn();
      await refreshBalances();
    } catch (e) {
      borrowLogError(`[ui] ${label}`, e);
      setErr(friendlyTxError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const canUnwrapWsolUi = useMemo(() => {
    const raw = humanTokenToRaw(
      portfolio.collateralBal.trim(),
      portfolio.collateralDecimals,
    );
    return raw !== null && raw >= BigInt(1);
  }, [portfolio.collateralBal, portfolio.collateralDecimals]);

  const runUnwrapAllWsol = useCallback(async () => {
    setErr(null);
    if (!publicKey || !signTransaction) {
      setErr("Connect a wallet that can sign transactions.");
      return;
    }
    setUnwrapWsolBusy(true);
    try {
      const collateralMint = getCollateralMint();
      const ata = getAssociatedTokenAddressSync(
        collateralMint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
      );
      let acc;
      try {
        acc = await getAccount(
          connection,
          ata,
          "confirmed",
          TOKEN_PROGRAM_ID,
        );
      } catch {
        setErr("No WSOL to unwrap.");
        return;
      }
      if (acc.amount <= BigInt(0)) {
        setErr("No WSOL to unwrap.");
        return;
      }
      if (acc.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
        setErr("WSOL balance is too large for this unwrap path.");
        return;
      }
      /**
       * Native mint (WSOL): SPL Token does not support Burn / BurnChecked (error 0xa). Unwrap by
       * CloseAccount only — for native-mint accounts, close may succeed with non-zero balance and
       * sends all lamports (wrapped SOL + rent) to the destination. See spl.solana.com/token §Wrapping SOL.
       * Other mints: burn to zero then close to reclaim rent.
       */
      const isNativeMint = collateralMint.equals(NATIVE_MINT);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      });
      if (isNativeMint) {
        tx.add(
          createCloseAccountInstruction(
            ata,
            publicKey,
            publicKey,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      } else {
        const mintInfo = await getMint(connection, collateralMint);
        tx.add(
          createBurnCheckedInstruction(
            ata,
            collateralMint,
            publicKey,
            acc.amount,
            mintInfo.decimals,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
        tx.add(
          createCloseAccountInstruction(
            ata,
            publicKey,
            publicKey,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      }

      const signed = await signTransaction(tx);
      const raw =
        signed &&
        typeof (signed as { serialize?: () => Uint8Array }).serialize ===
          "function"
          ? (signed as Transaction).serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            })
          : null;
      if (!raw?.length) {
        throw new Error("Wallet did not return a serializable transaction.");
      }

      const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      let st =
        (
          await connection.getSignatureStatuses([sig], {
            searchTransactionHistory: true,
          })
        ).value[0] ?? null;
      if (st == null) {
        await new Promise((r) => setTimeout(r, 500));
        st =
          (
            await connection.getSignatureStatuses([sig], {
              searchTransactionHistory: true,
            })
          ).value[0] ?? null;
      }
      if (st?.err) {
        let logTail = "";
        try {
          const detail = await connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          const logs = detail?.meta?.logMessages;
          if (logs?.length) {
            logTail = `\n${logs.slice(-16).join("\n")}`;
          }
        } catch {
          /* ignore */
        }
        throw new Error(
          `Unwrap failed on-chain: ${JSON.stringify(st.err)}${logTail}`,
        );
      }

      await refreshBalances();
    } catch (e) {
      if (!isUserRejectedError(e)) {
        borrowLogError("[ui] unwrap wsol", e);
      }
      if (e instanceof SendTransactionError) {
        try {
          const logs = await e.getLogs(connection);
          setErr(
            isUserRejectedError(e)
              ? "Unwrap cancelled."
              : `${e.message}${logs?.length ? `\n${logs.join("\n")}` : ""}`,
          );
        } catch {
          setErr(
            isUserRejectedError(e)
              ? "Unwrap cancelled."
              : e.message,
          );
        }
        return;
      }
      setErr(
        isUserRejectedError(e)
          ? "Unwrap cancelled."
          : e instanceof Error
            ? e.message
            : "Unwrap failed.",
      );
    } finally {
      setUnwrapWsolBusy(false);
    }
  }, [publicKey, signTransaction, connection, refreshBalances, colMintKey]);

  const posColRaw = portfolio.position?.collateralAmount ?? new BN(0);
  const posDebtRaw = portfolio.position?.debtAmount ?? new BN(0);
  const deskSnap = portfolio.deskSnapshot;

  const walletSolCapRaw = useMemo(() => {
    const baseSplSol = toRawAmount(
      portfolio.collateralBal,
      portfolio.collateralDecimals,
    );
    const nativeSpend = spendableNativeSolRaw(
      portfolio.nativeSolBal,
      portfolio.collateralDecimals,
    );
    return bnMax(baseSplSol, nativeSpend);
  }, [portfolio.collateralBal, portfolio.nativeSolBal, portfolio.collateralDecimals]);

  const borrowDerived = useMemo(() => {
    if (!deskSnap) {
      return {
        effBorrow: new BN(0),
        depositNeeded: new BN(0),
        maxBorrowAllowedRaw: new BN(0),
      };
    }
    const poolLiq = deskSnap.vaultLiquidityRaw;
    const maxAllowed = maxIncrementalBorrowAllowed(
      posColRaw.add(walletSolCapRaw),
      deskSnap.collateralPriceQ12,
      deskSnap.ltvMaxBps,
      posDebtRaw,
      poolLiq,
    );
    const want = toRawAmount(borrowWantIn.trim(), portfolio.borrowDecimals);
    const eff = bnMin(bnMin(want, poolLiq), maxAllowed);
    const targetDebt = posDebtRaw.add(eff);
    const minCol = minCollateralForBorrowRaw(
      targetDebt,
      deskSnap.collateralPriceQ12,
      deskSnap.ltvMaxBps,
    );
    const dep = bnMax(minCol.sub(posColRaw), new BN(0));
    return {
      effBorrow: eff,
      depositNeeded: dep,
      maxBorrowAllowedRaw: maxAllowed,
    };
  }, [
    deskSnap,
    borrowWantIn,
    portfolio.borrowDecimals,
    posColRaw,
    posDebtRaw,
    walletSolCapRaw,
  ]);

  const amountRawBig = useMemo(() => {
    const d = shieldAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS;
    return humanTokenToRaw(perFlowAmount.trim(), d);
  }, [perFlowAmount, shieldAsset]);

  const amountOk =
    amountRawBig !== null &&
    amountRawBig >= BigInt(1) &&
    amountRawBig <= BigInt(Number.MAX_SAFE_INTEGER);

  const baseMaxRaw = useMemo(() => {
    if (shieldAsset === "usdc") {
      return (
        humanTokenToRaw(portfolio.borrowBal.trim(), USDC_DECIMALS) ?? BigInt(0)
      );
    }
    return BigInt(walletSolCapRaw.toString(10));
  }, [shieldAsset, portfolio.borrowBal, walletSolCapRaw]);

  const privateMaxRaw = useMemo(() => {
    const s =
      shieldAsset === "usdc"
        ? portfolio.shieldedBorrow
        : portfolio.shieldedCollateral;
    return parseRawBalanceIntString(s);
  }, [shieldAsset, portfolio.shieldedBorrow, portfolio.shieldedCollateral]);

  const canAffordShield =
    shieldMode !== "shield" ||
    (amountRawBig !== null &&
      amountRawBig >= BigInt(1) &&
      amountRawBig <= baseMaxRaw);

  const canAffordUnshield =
    shieldMode !== "unshield" ||
    (amountRawBig !== null &&
      amountRawBig >= BigInt(1) &&
      privateMaxRaw !== null &&
      amountRawBig <= privateMaxRaw);

  const privateSendRecipientPk = useMemo(() => {
    const t = privateSendTo.trim();
    if (!t) return null;
    try {
      return new PublicKey(t);
    } catch {
      return null;
    }
  }, [privateSendTo]);

  const privateSendRecipientOk =
    privateSendRecipientPk !== null &&
    publicKey !== null &&
    !privateSendRecipientPk.equals(publicKey);

  const privateSendMaxRaw = useMemo(() => {
    const s =
      privateSendAsset === "usdc"
        ? portfolio.shieldedBorrow
        : portfolio.shieldedCollateral;
    return parseRawBalanceIntString(s);
  }, [
    privateSendAsset,
    portfolio.shieldedBorrow,
    portfolio.shieldedCollateral,
  ]);

  const privateSendRawBig = useMemo(() => {
    const d = privateSendAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS;
    return humanTokenToRaw(privateSendAmount.trim(), d);
  }, [privateSendAmount, privateSendAsset]);

  const privateSendAmountOk =
    privateSendRawBig !== null &&
    privateSendRawBig >= BigInt(1) &&
    privateSendRawBig <= BigInt(Number.MAX_SAFE_INTEGER);

  const perMaxDisabledRaw =
    shieldMode === "shield"
      ? baseMaxRaw <= BigInt(0)
      : privateMaxRaw === null || privateMaxRaw <= BigInt(0);

  /** Upper bound for the current shield / unshield mode (used for Half). */
  const perFlowCapRaw = useMemo(() => {
    if (shieldMode === "shield") return baseMaxRaw;
    return privateMaxRaw ?? BigInt(0);
  }, [shieldMode, baseMaxRaw, privateMaxRaw]);

  const perHalfButtonDisabled =
    formDisabled || perMaxDisabledRaw || perFlowCapRaw < BigInt(2);

  const perPrimaryDisabled =
    formDisabled ||
    !amountOk ||
    (shieldMode === "shield" && !canAffordShield) ||
    (shieldMode === "unshield" && !canAffordUnshield);

  const privateSendPrimaryDisabled =
    formDisabled ||
    !privateSendAmountOk ||
    privateSendMaxRaw === null ||
    privateSendRawBig === null ||
    privateSendRawBig > privateSendMaxRaw ||
    !privateSendRecipientOk;

  const privateSendMaxButtonDisabled =
    formDisabled ||
    privateSendMaxRaw === null ||
    privateSendMaxRaw <= BigInt(0);

  const privateSendHalfButtonDisabled =
    formDisabled ||
    privateSendMaxRaw === null ||
    privateSendMaxRaw < BigInt(2);

  const setMaxForPerFlow = useCallback(() => {
    if (shieldMode === "shield") {
      if (shieldAsset === "usdc") {
        const m = humanTokenToRaw(portfolio.borrowBal.trim(), USDC_DECIMALS);
        if (m !== null && m > BigInt(0)) {
          setPerFlowAmount(rawToHuman(m, USDC_DECIMALS));
        }
      } else {
        const m = BigInt(walletSolCapRaw.toString(10));
        if (m > BigInt(0)) {
          setPerFlowAmount(rawToHuman(m, SOL_DECIMALS));
        }
      }
      return;
    }
    if (privateMaxRaw !== null && privateMaxRaw > BigInt(0)) {
      setPerFlowAmount(
        rawToHuman(
          privateMaxRaw,
          shieldAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS,
        ),
      );
    }
  }, [
    shieldMode,
    shieldAsset,
    portfolio.borrowBal,
    walletSolCapRaw,
    privateMaxRaw,
  ]);

  const setHalfForPerFlow = useCallback(() => {
    const dec = shieldAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS;
    let capRaw: bigint;
    if (shieldMode === "shield") {
      if (shieldAsset === "usdc") {
        capRaw =
          humanTokenToRaw(portfolio.borrowBal.trim(), USDC_DECIMALS) ??
          BigInt(0);
      } else {
        capRaw = BigInt(walletSolCapRaw.toString(10));
      }
    } else {
      capRaw = privateMaxRaw ?? BigInt(0);
    }
    if (capRaw < BigInt(2)) return;
    const halfRaw = capRaw / BigInt(2);
    setPerFlowAmount(rawToHuman(halfRaw, dec));
  }, [
    shieldMode,
    shieldAsset,
    portfolio.borrowBal,
    walletSolCapRaw,
    privateMaxRaw,
  ]);

  const setMaxForPrivateSend = useCallback(() => {
    if (privateSendMaxRaw !== null && privateSendMaxRaw > BigInt(0)) {
      setPrivateSendAmount(
        rawToHuman(
          privateSendMaxRaw,
          privateSendAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS,
        ),
      );
    }
  }, [privateSendMaxRaw, privateSendAsset]);

  const setHalfForPrivateSend = useCallback(() => {
    if (privateSendMaxRaw === null || privateSendMaxRaw < BigInt(2)) return;
    const halfRaw = privateSendMaxRaw / BigInt(2);
    setPrivateSendAmount(
      rawToHuman(
        halfRaw,
        privateSendAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS,
      ),
    );
  }, [privateSendMaxRaw, privateSendAsset]);

  /** Lend only uses shielded borrow mint (USDC) from PER — same raw string as Shield / Unshield. */
  const lendMaxShieldedRaw = useMemo(
    () => parseRawBalanceIntString(portfolio.shieldedBorrow),
    [portfolio.shieldedBorrow],
  );

  const lendAmountRawBig = useMemo(
    () => humanTokenToRaw(lendAmount.trim(), USDC_DECIMALS),
    [lendAmount],
  );

  const lendDepositAmountOk =
    lendAmountRawBig !== null &&
    lendAmountRawBig >= BigInt(1) &&
    lendAmountRawBig <= BigInt(Number.MAX_SAFE_INTEGER) &&
    lendMaxShieldedRaw !== null &&
    lendAmountRawBig <= lendMaxShieldedRaw;

  const lendMaxButtonDisabled =
    formDisabled ||
    lenderNeedsActivate ||
    !ledgerDelegated ||
    lendMaxShieldedRaw === null ||
    lendMaxShieldedRaw <= BigInt(0);

  const setMaxForLendDeposit = useCallback(() => {
    if (lendMaxShieldedRaw !== null && lendMaxShieldedRaw > BigInt(0)) {
      setLendAmount(rawToHuman(lendMaxShieldedRaw, USDC_DECIMALS));
    }
  }, [lendMaxShieldedRaw]);

  const lendHalfButtonDisabled =
    lendMaxButtonDisabled ||
    lendMaxShieldedRaw === null ||
    lendMaxShieldedRaw < BigInt(2);

  const setHalfForLendDeposit = useCallback(() => {
    if (lendMaxShieldedRaw === null || lendMaxShieldedRaw < BigInt(2)) return;
    const halfRaw = lendMaxShieldedRaw / BigInt(2);
    setLendAmount(rawToHuman(halfRaw, USDC_DECIMALS));
  }, [lendMaxShieldedRaw]);

  const lendDepositPrimaryDisabled =
    formDisabled ||
    lenderNeedsActivate ||
    !ledgerDelegated ||
    !deskSnap ||
    !lendDepositAmountOk;

  const runPerShieldFlow = useCallback(async () => {
    setErr(null);
    if (!publicKey || !signTransaction) {
      setErr("Connect a wallet that can sign transactions.");
      return;
    }
    const dec = shieldAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS;
    const mintPk = shieldAsset === "usdc" ? borMintKey : colMintKey;
    const rawBn = humanTokenToRaw(perFlowAmount.trim(), dec);
    if (
      rawBn === null ||
      rawBn < BigInt(1) ||
      rawBn > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      setErr("Enter a valid amount.");
      return;
    }
    if (shieldMode === "unshield") {
      if (privateMaxRaw === null || rawBn > privateMaxRaw) {
        setErr(
          "Unshield only uses your private PER balance. Shield first, or lower the amount.",
        );
        return;
      }
    } else if (rawBn > baseMaxRaw) {
      setErr(
        shieldAsset === "sol"
          ? "Amount exceeds your spendable SOL (WSOL + native after fee reserve)."
          : "Amount exceeds your public USDC balance.",
      );
      return;
    }
    setBusy(true);
    try {
      const endpoint =
        shieldMode === "shield"
          ? "/api/per/deposit/unsigned"
          : "/api/per/withdraw/unsigned";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          amount: Number(rawBn),
          mint: mintPk,
        }),
      });
      const json = (await res.json()) as { error?: string } & UnsignedTxResponse;
      if (!res.ok || json.error) {
        throw new Error(
          json.error ??
          (shieldMode === "shield"
            ? "Shield request failed"
            : "Unshield request failed"),
        );
      }

      const walletLike = {
        publicKey,
        signTransaction,
        signMessage: signMessage ?? undefined,
      };
      const baseRpc = getPublicBaseRpc();
      const ephRpc = getPublicEphemeralRpc();
      const tee = getPublicUseTeeAuth();
      const splBaseConn = new Connection(baseRpc, { commitment: "confirmed" });
      const colPk = new PublicKey(colMintKey);
      const collateralIsNativeSol =
        colPk.equals(NATIVE_MINT) ||
        colMintKey === NATIVE_MINT.toBase58();

      const shieldSolWithAutoWrap =
        shieldMode === "shield" &&
        shieldAsset === "sol" &&
        collateralIsNativeSol &&
        json.sendTo === "base";

      if (shieldSolWithAutoWrap) {
        const wsolNow = await getWsolLamportsOnBase(splBaseConn, publicKey);
        const needWrap = rawBn > wsolNow ? rawBn - wsolNow : BigInt(0);
        if (needWrap > BigInt(0)) {
          const prepend = await buildWrapNativeSolIntoWsolInstructions(
            splBaseConn,
            publicKey,
            publicKey,
            needWrap,
          );
          await submitPerTransactionMerged(
            json,
            walletLike,
            baseRpc,
            ephRpc,
            tee,
            { connection: splBaseConn, prepend },
          );
        } else {
          await submitPreparedPerTransaction(
            json,
            walletLike,
            baseRpc,
            ephRpc,
            tee,
          );
        }
      } else {
        await submitPreparedPerTransaction(
          json,
          walletLike,
          baseRpc,
          ephRpc,
          tee,
        );
      }

      setPerFlowAmount("");
      await refreshBalances();
      window.setTimeout(() => {
        void refreshBalances();
      }, 2000);
    } catch (e) {
      if (!isUserRejectedError(e)) {
        borrowLogError("[ui] per shield flow", e);
      }
      let msg = e instanceof Error ? e.message : "Request failed";
      if (
        /don't have enough|not enough tokens|insufficient/i.test(msg) &&
        shieldMode === "shield" &&
        shieldAsset === "sol"
      ) {
        msg =
          "Not enough SOL to shield (native + WSOL after fees). Try a smaller amount or leave more SOL for fees.";
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [
    publicKey,
    signTransaction,
    signMessage,
    shieldAsset,
    shieldMode,
    perFlowAmount,
    borMintKey,
    colMintKey,
    privateMaxRaw,
    baseMaxRaw,
    refreshBalances,
  ]);

  const runPerPrivateSendFlow = useCallback(async () => {
    setErr(null);
    if (!publicKey || !signTransaction) {
      setErr("Connect a wallet that can sign transactions.");
      return;
    }
    if (!privateSendRecipientPk || privateSendRecipientPk.equals(publicKey)) {
      setErr("Enter a valid recipient address (not your own wallet).");
      return;
    }
    const dec = privateSendAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS;
    const mintPk = privateSendAsset === "usdc" ? borMintKey : colMintKey;
    const rawBn = humanTokenToRaw(privateSendAmount.trim(), dec);
    if (
      rawBn === null ||
      rawBn < BigInt(1) ||
      rawBn > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      setErr("Enter a valid amount.");
      return;
    }
    if (privateSendMaxRaw === null || rawBn > privateSendMaxRaw) {
      setErr(
        "Amount exceeds your private PER balance for this mint. Shield first or lower the amount.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/per/transfer/unsigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: publicKey.toBase58(),
          to: privateSendRecipientPk.toBase58(),
          amount: Number(rawBn),
          mint: mintPk,
        }),
      });
      const json = (await res.json()) as { error?: string } & UnsignedTxResponse;
      if (!res.ok || json.error) {
        throw new Error(json.error ?? "Private send request failed");
      }
      const walletLike = {
        publicKey,
        signTransaction,
        signMessage: signMessage ?? undefined,
      };
      await submitPreparedPerTransaction(
        json,
        walletLike,
        getPublicBaseRpc(),
        getPublicEphemeralRpc(),
        getPublicUseTeeAuth(),
      );
      setPrivateSendAmount("");
      await refreshBalances();
      window.setTimeout(() => {
        void refreshBalances();
      }, 2000);
    } catch (e) {
      if (!isUserRejectedError(e)) {
        borrowLogError("[ui] per private send", e);
      }
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [
    publicKey,
    signTransaction,
    signMessage,
    privateSendAsset,
    privateSendAmount,
    borMintKey,
    colMintKey,
    privateSendMaxRaw,
    privateSendRecipientPk,
    refreshBalances,
  ]);

  const cluster = getSolanaCluster();
  const labels = pairLabels();

  const inputClass =
    "h-10 w-full min-w-0 flex-1 border-0 bg-transparent px-3 text-base font-medium tabular-nums text-foreground outline-none placeholder:text-muted-foreground";

  return {
    cluster,
    labels,
    connection,
    anchorWallet,
    publicKey,
    signTransaction,
    signMessage,
    connected,
    programId,
    deskPda,
    colMintKey,
    borMintKey,
    mainTab,
    setMainTab,
    portfolio,
    shieldMode,
    setShieldMode,
    shieldAsset,
    setShieldAsset,
    perFlowAmount,
    setPerFlowAmount,
    privateSendAsset,
    setPrivateSendAsset,
    privateSendAmount,
    setPrivateSendAmount,
    privateSendTo,
    setPrivateSendTo,
    lendAmount,
    setLendAmount,
    withdrawLpIn,
    setWithdrawLpIn,
    withdrawColIn,
    setWithdrawColIn,
    repayIn,
    setRepayIn,
    borrowWantIn,
    setBorrowWantIn,
    depositColIn,
    setDepositColIn,
    err,
    setErr,
    busy,
    unwrapWsolBusy,
    deskReady,
    deskOnline,
    borrowerNeedsActivate,
    lenderNeedsActivate,
    ledgerDelegated,
    formDisabled,
    signMessageSafe,
    refreshBalances,
    runWithEr,
    runWithBase,
    canUnwrapWsolUi,
    runUnwrapAllWsol,
    posColRaw,
    posDebtRaw,
    deskSnap,
    walletSolCapRaw,
    borrowDerived,
    amountRawBig,
    amountOk,
    baseMaxRaw,
    privateMaxRaw,
    canAffordShield,
    canAffordUnshield,
    privateSendRecipientPk,
    privateSendRecipientOk,
    privateSendMaxRaw,
    privateSendRawBig,
    privateSendAmountOk,
    perMaxDisabledRaw,
    perFlowCapRaw,
    perHalfButtonDisabled,
    perPrimaryDisabled,
    privateSendPrimaryDisabled,
    privateSendMaxButtonDisabled,
    privateSendHalfButtonDisabled,
    setMaxForPerFlow,
    setHalfForPerFlow,
    setMaxForPrivateSend,
    setHalfForPrivateSend,
    lendMaxShieldedRaw,
    lendAmountRawBig,
    lendDepositAmountOk,
    lendMaxButtonDisabled,
    lendHalfButtonDisabled,
    lendDepositPrimaryDisabled,
    setMaxForLendDeposit,
    setHalfForLendDeposit,
    runPerShieldFlow,
    runPerPrivateSendFlow,
    inputClass,
    toRawAmount,
    formatRaw,
    humanTokenToRaw,
    sanitizeDecimalInput,
    USDC_DECIMALS,
    SOL_DECIMALS,
  };
}

export type ConfidentialLendingDeskModel = ReturnType<
  typeof useConfidentialLendingDesk
>;
