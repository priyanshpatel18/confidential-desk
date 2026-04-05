"use client";

import { BN } from "@coral-xyz/anchor";
import {
  createBurnCheckedInstruction,
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
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import rawIdl from "@/lib/confidential_desk.json";
import {
    activatePosition,
    borrow,
    closePosition,
    computeLpMintedForDeposit,
    depositCollateral,
    depositLiquidity,
    DESK_LEDGER_INACTIVE_PREFIX,
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
import {
    deskInvalidWritableRollupMessage,
    messageLooksLikeInvalidWritableOnRollup,
} from "@/lib/desk-rpc-policy";
import { createDeskProgram } from "@/lib/desk-program";
import { getEphemeralConnectionForBorrow } from "@/lib/ephemeral-connection";
import {
    formatSolLineFromRaw,
    formatUsdcLineFromRaw,
    humanTokenToRaw,
    parseRawBalanceIntString,
    rawToHuman,
    sanitizeDecimalInput,
    SOL_DECIMALS,
    USDC_DECIMALS,
} from "@/lib/format-shield-amounts";
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
import { submitPreparedPerTransaction } from "@/lib/per-wallet-submit";
import { cn } from "@/lib/utils";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import Image from "next/image";

const SOL_ICON_SRC = "/solana.svg";

/** `app/public/usdc.png` — Circle USDC mark (not a generic blue placeholder). */
function UsdcIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/usdc.png"
      alt=""
      width={32}
      height={32}
      className={cn("size-5 shrink-0 object-contain", className)}
      aria-hidden
    />
  );
}

function TokenIcon({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt=""
      width={20}
      height={20}
      className={cn("size-5 shrink-0 object-contain", className)}
      aria-hidden
    />
  );
}

function toRawAmount(amountStr: string, decimals: number): BN {
  const t = amountStr.trim();
  if (!t || !/^\d*\.?\d*$/.test(t)) return new BN(0);
  const [whole, frac = ""] = t.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole || "0"}${fracPadded}`.replace(/^0+/, "") || "0";
  return new BN(combined);
}

function formatRaw(raw: BN, decimals: number): string {
  const s = raw.toString(10).padStart(decimals + 1, "0");
  if (decimals === 0) return s;
  const i = s.length - decimals;
  const intPart = s.slice(0, i).replace(/^0+/, "") || "0";
  const fracPart = s.slice(i).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function formatNativeSol(lamports: number): string {
  if (lamports === 0) return "0";
  const n = lamports / LAMPORTS_PER_SOL;
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s || "0";
}

function bnMin(a: BN, b: BN): BN {
  return a.lt(b) ? a : b;
}

function bnMax(a: BN, b: BN): BN {
  return a.gt(b) ? a : b;
}

const NATIVE_SOL_FEE_RESERVE_LAMPORTS = new BN(10_000_000);

function spendableNativeSolRaw(
  nativeSolDisplay: string,
  collateralDecimals: number,
): BN {
  const raw = toRawAmount(nativeSolDisplay, collateralDecimals);
  const out = raw.sub(NATIVE_SOL_FEE_RESERVE_LAMPORTS);
  return out.gt(new BN(0)) ? out : new BN(0);
}

async function getWsolLamportsOnBase(
  connection: Connection,
  owner: PublicKey,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return BigInt(0);
  }
}

/** Wait until base-layer WSOL ATA reflects the PER withdraw credit (settlement can lag). */
async function waitForWsolCreditAfterUnshield(
  connection: Connection,
  owner: PublicKey,
  lamportsUnshielded: bigint,
  balanceBefore: bigint,
): Promise<void> {
  const feeSlack = BigInt(10_000);
  const minCredit =
    lamportsUnshielded > feeSlack
      ? lamportsUnshielded - feeSlack
      : lamportsUnshielded;
  const threshold = balanceBefore + minCredit;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const now = await getWsolLamportsOnBase(connection, owner);
    if (now >= threshold) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(
    "Timed out waiting for unshielded WSOL on Solana base. Check your WSOL token account or RPC.",
  );
}

/** Burn WSOL on base so lamports return as native SOL (amount capped by ATA balance). */
async function unwrapWsolAfterUnshield(
  connection: Connection,
  owner: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  lamportsUnshielded: bigint,
  collateralMintPk: PublicKey,
): Promise<void> {
  if (!collateralMintPk.equals(NATIVE_MINT) || lamportsUnshielded <= BigInt(0)) {
    return;
  }

  const ata = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );

  let acc;
  try {
    acc = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
  } catch {
    throw new Error(
      "Could not read your WSOL account on Solana base to unwrap.",
    );
  }

  const burnAmt =
    acc.amount < lamportsUnshielded ? acc.amount : lamportsUnshielded;
  if (burnAmt <= BigInt(0)) {
    throw new Error("WSOL balance on base is zero; nothing to unwrap.");
  }

  if (burnAmt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Unwrap amount too large.");
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash,
  }).add(
    createBurnCheckedInstruction(
      ata,
      NATIVE_MINT,
      owner,
      burnAmt,
      9,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
}

function coercePerBalance(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? "—" : t;
  }
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return String(Math.trunc(v));
  }
  return "—";
}

function friendlyTxError(message: string): string {
  if (/Account does not exist or has no data/i.test(message)) {
    return (
      "The confidential lending desk is not initialized on this network yet. " +
      "Run initialize_desk once for SOL + cluster USDC."
    );
  }
  if (message.includes(DESK_LEDGER_INACTIVE_PREFIX)) {
    return message.replace(DESK_LEDGER_INACTIVE_PREFIX, "").trim();
  }
  if (messageLooksLikeInvalidWritableOnRollup(message)) {
    return deskInvalidWritableRollupMessage();
  }
  return message;
}

const cluster = getSolanaCluster();
const labels = pairLabels();

type Portfolio = {
  collateralDecimals: number;
  borrowDecimals: number;
  lpDecimals: number;
  nativeSolBal: string;
  collateralBal: string;
  borrowBal: string;
  lpBal: string;
  shieldedCollateral: string;
  shieldedBorrow: string;
  deskBorrowedDisplay: string;
  position: PositionData | null;
  lender: LenderPositionData | null;
  deskSnapshot: DeskSummary | null;
};

const initialPortfolio: Portfolio = {
  collateralDecimals: 9,
  borrowDecimals: 6,
  lpDecimals: 6,
  nativeSolBal: "0",
  collateralBal: "0",
  borrowBal: "0",
  lpBal: "0",
  shieldedCollateral: "—",
  shieldedBorrow: "—",
  deskBorrowedDisplay: "0",
  position: null,
  lender: null,
  deskSnapshot: null,
};

export function ConfidentialLendingDesk() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { publicKey, signTransaction, signMessage, connected } = wallet;

  const [mainTab, setMainTab] = useState<"shield" | "lend" | "borrow">(
    "shield",
  );
  const [portfolio, setPortfolio] = useState<Portfolio>(initialPortfolio);
  const [shieldMode, setShieldMode] = useState<"shield" | "unshield">("shield");
  const [shieldAsset, setShieldAsset] = useState<"sol" | "usdc">("usdc");
  const [perFlowAmount, setPerFlowAmount] = useState("");
  const [lendAmount, setLendAmount] = useState("");
  const [withdrawLpIn, setWithdrawLpIn] = useState("");
  const [withdrawColIn, setWithdrawColIn] = useState("");
  const [repayIn, setRepayIn] = useState("");
  const [borrowWantIn, setBorrowWantIn] = useState("");
  const [depositColIn, setDepositColIn] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      setPortfolio((p) => ({
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
        const erProg = new (
          await import("@coral-xyz/anchor")
        ).Program(
          rawIdl as import("@coral-xyz/anchor").Idl,
          new (
            await import("@coral-xyz/anchor")
          ).AnchorProvider(erConn, aw, { skipPreflight: true }),
        );
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

  /** Max SOL you can shield: public WSOL in your ATA (same pattern as Payflow base balance). */
  const shieldSolMaxRaw = useMemo(() => {
    return toRawAmount(
      portfolio.collateralBal,
      portfolio.collateralDecimals,
    );
  }, [portfolio.collateralBal, portfolio.collateralDecimals]);

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
    return BigInt(shieldSolMaxRaw.toString(10));
  }, [shieldAsset, portfolio.borrowBal, shieldSolMaxRaw]);

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

  const perMaxDisabledRaw =
    shieldMode === "shield"
      ? baseMaxRaw <= BigInt(0)
      : privateMaxRaw === null || privateMaxRaw <= BigInt(0);

  /** Upper bound for the current shield/unshield mode (used for Half). */
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

  const setMaxForPerFlow = useCallback(() => {
    if (shieldMode === "shield") {
      if (shieldAsset === "usdc") {
        const m = humanTokenToRaw(portfolio.borrowBal.trim(), USDC_DECIMALS);
        if (m !== null && m > BigInt(0)) {
          setPerFlowAmount(rawToHuman(m, USDC_DECIMALS));
        }
      } else {
        const m = BigInt(shieldSolMaxRaw.toString(10));
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
    shieldSolMaxRaw,
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
        capRaw = BigInt(shieldSolMaxRaw.toString(10));
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
    shieldSolMaxRaw,
    privateMaxRaw,
  ]);

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
          ? "Amount exceeds your public WSOL balance. Wrap native SOL first if needed."
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

      const solUnshieldNeedsUnwrap =
        shieldMode === "unshield" &&
        shieldAsset === "sol" &&
        colPk.equals(NATIVE_MINT);

      const wsolBeforeUnshield = solUnshieldNeedsUnwrap
        ? await getWsolLamportsOnBase(splBaseConn, publicKey)
        : BigInt(0);

      await submitPreparedPerTransaction(
        json,
        walletLike,
        baseRpc,
        ephRpc,
        tee,
      );

      if (solUnshieldNeedsUnwrap) {
        try {
          await waitForWsolCreditAfterUnshield(
            splBaseConn,
            publicKey,
            rawBn,
            wsolBeforeUnshield,
          );
          await unwrapWsolAfterUnshield(
            splBaseConn,
            publicKey,
            signTransaction,
            rawBn,
            colPk,
          );
        } catch (unwrapErr) {
          if (!isUserRejectedError(unwrapErr)) {
            borrowLogError("[ui] unwrap after unshield", unwrapErr);
          }
          setErr(
            isUserRejectedError(unwrapErr)
              ? "Unshield completed; unwrap to native SOL was cancelled. WSOL remains in your token account."
              : unwrapErr instanceof Error
                ? `Unshield completed, but unwrap failed: ${unwrapErr.message}`
                : "Unshield completed, but unwrap failed. Check your WSOL balance.",
          );
        }
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
          "Not enough WSOL in your token account. Wrap native SOL to WSOL, then try again.";
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

  const inputClass =
    "h-10 w-full min-w-0 flex-1 border-0 bg-transparent px-3 text-base font-medium tabular-nums text-foreground outline-none placeholder:text-muted-foreground";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Private Lending Desk
            </h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <TokenIcon src={SOL_ICON_SRC} className="size-4" />
                {labels.collateral}
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                /
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UsdcIcon className="size-4" />
                {labels.borrow}
              </span>
              <span className="text-muted-foreground/50">·</span>
              <span>{cluster === "devnet" ? "Devnet" : "Mainnet"}</span>
            </p>
          </div>
        </div>
        <WalletMultiButton />
      </header>


      <Card className="w-full">
        <CardHeader>
          <CardTitle>Balances</CardTitle>
          <CardDescription>
            Native SOL and USDC on Solana, plus shielded (PER) balances.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
              <TokenIcon src={SOL_ICON_SRC} className="size-4" />
              SOL (native)
            </div>
            <div className="font-mono text-lg tabular-nums">
              {portfolio.nativeSolBal} SOL
            </div>
          </div>
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
              <UsdcIcon className="size-4" />
              {labels.borrow}
            </div>
            <div className="font-mono text-lg tabular-nums">
              {portfolio.borrowBal} USDC
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase">LP shares</div>
            <div className="font-mono text-lg">{portfolio.lpBal}</div>
          </div>
          <Separator className="sm:col-span-2" />
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
              <TokenIcon src={SOL_ICON_SRC} className="size-4" />
              Shielded {labels.collateral}
            </div>
            <div className="font-mono text-lg tabular-nums">
              {formatSolLineFromRaw(portfolio.shieldedCollateral)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
              <UsdcIcon className="size-4" />
              Shielded {labels.borrow}
            </div>
            <div className="font-mono text-lg tabular-nums">
              {formatUsdcLineFromRaw(portfolio.shieldedBorrow)}
            </div>
          </div>
        </CardContent>
      </Card>

      {!deskOnline && deskReady !== null && (
        <Alert>
          <AlertTitle>Desk offline</AlertTitle>
          <AlertDescription>
            No desk account for this mint pair on the current RPC. Initialize
            the program on-chain first.
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={mainTab}
        onValueChange={(v) => setMainTab(v as typeof mainTab)}
        className="w-full min-w-0"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="shield">Shield / Unshield</TabsTrigger>
          <TabsTrigger value="lend">Lend</TabsTrigger>
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
        </TabsList>

        <TabsContent value="shield" className="w-full min-w-0 space-y-4">
          <Card className="border-border bg-card/80 shadow-lg shadow-black/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Private payments</CardTitle>
              <CardDescription className="text-xs">
                Move tokens between base Solana and the PER rollup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="inline-flex items-center gap-2">
                  {shieldAsset === "usdc" ? (
                    <UsdcIcon className="size-4" />
                  ) : (
                    <TokenIcon src={SOL_ICON_SRC} className="size-4" />
                  )}
                  Mint
                </Label>
                <select
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  value={shieldAsset}
                  disabled={formDisabled}
                  onChange={(e) => {
                    setShieldAsset(e.target.value as "sol" | "usdc");
                    setErr(null);
                  }}
                >
                  <option value="sol">{labels.collateral}</option>
                  <option value="usdc">{labels.borrow}</option>
                </select>
              </div>

              <div
                className="flex rounded-xl border border-border bg-muted/40 p-1"
                role="tablist"
                aria-label="Action"
              >
                {(
                  [
                    ["shield", "Shield"],
                    ["unshield", "Unshield"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={shieldMode === m}
                    disabled={formDisabled}
                    className={cn(
                      "flex-1 rounded-lg py-2.5 text-center text-xs font-semibold transition-colors",
                      shieldMode === m
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setShieldMode(m);
                      setErr(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-muted-foreground mb-1 block text-[11px] font-medium">
                  Amount
                </label>
                <div className="border-border bg-input/30 focus-within:border-ring flex items-center gap-2 rounded-xl border pr-2 focus-within:ring-[3px] focus-within:ring-ring/50">
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="0.00"
                    value={perFlowAmount}
                    disabled={formDisabled}
                    onChange={(e) =>
                      setPerFlowAmount(
                        sanitizeDecimalInput(
                          e.target.value,
                          shieldAsset === "usdc"
                            ? USDC_DECIMALS
                            : SOL_DECIMALS,
                        ),
                      )
                    }
                  />
                  <span className="text-muted-foreground shrink-0 text-sm font-semibold">
                    {shieldAsset === "usdc" ? labels.borrow : labels.collateral}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                      disabled={perHalfButtonDisabled}
                      onClick={setHalfForPerFlow}
                    >
                      Half
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                      disabled={formDisabled || perMaxDisabledRaw}
                      onClick={setMaxForPerFlow}
                    >
                      Max
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {shieldMode === "shield"
                    ? shieldAsset === "usdc"
                      ? "Half / Max use your public USDC (wallet ATA)."
                      : "Half / Max use your public WSOL (wrap native SOL first if you only hold SOL)."
                    : shieldAsset === "usdc"
                      ? "Half / Max use your private PER USDC; unshield returns it to base."
                      : "Half / Max use your private PER SOL. Unshield signs PER withdraw, then a second tx unwraps WSOL to native SOL."}
                </p>
              </div>

              <Button
                variant="default"
                size="lg"
                className="w-full rounded-xl"
                disabled={perPrimaryDisabled}
                onClick={() => void runPerShieldFlow()}
              >
                {busy
                  ? "Signing…"
                  : shieldMode === "shield"
                    ? "Shield"
                    : "Unshield"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lend" className="w-full min-w-0 space-y-4">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Lend shielded {labels.borrow}</CardTitle>
              <CardDescription>
                Deposit liquidity on the rollup and receive LP. Vault ATAs are
                created on Solana base (same as RPS tests); desk ledger must be
                delegated on base once (creator wallet).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!ledgerDelegated && (
                <p className="text-muted-foreground text-sm">
                  {DESK_LEDGER_INACTIVE_PREFIX} The desk authority must connect
                  once and activate a position so `desk_ledger` delegates to the
                  rollup.
                </p>
              )}
              <Button
                variant="outline"
                disabled={formDisabled || !anchorWallet}
                onClick={() =>
                  void runWithBase("Init desk vaults on base…", () =>
                    initDeskVaults({
                      connection,
                      wallet: anchorWallet!,
                    }),
                  )
                }
              >
                Init desk vaults (base)
              </Button>
              {lenderNeedsActivate && (
                <Button
                  disabled={formDisabled || !anchorWallet || !signMessage}
                  onClick={() =>
                    void runWithEr("Activate lender…", () =>
                      activatePosition({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        kind: "lender",
                      }),
                    )
                  }
                >
                  Activate lender position
                </Button>
              )}
              <div className="space-y-2">
                <Label>Deposit amount ({labels.borrow})</Label>
                <div className="border-border bg-input/30 focus-within:border-ring flex items-center gap-2 rounded-xl border pr-2 focus-within:ring-[3px] focus-within:ring-ring/50">
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="0.00"
                    value={lendAmount}
                    disabled={formDisabled || lenderNeedsActivate}
                    onChange={(e) => {
                      setErr(null);
                      setLendAmount(
                        sanitizeDecimalInput(e.target.value, USDC_DECIMALS),
                      );
                    }}
                  />
                  <span className="text-muted-foreground shrink-0 text-sm font-semibold">
                    {labels.borrow}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                      disabled={lendHalfButtonDisabled}
                      onClick={setHalfForLendDeposit}
                    >
                      Half
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                      disabled={lendMaxButtonDisabled}
                      onClick={setMaxForLendDeposit}
                    >
                      Max
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Half / Max use your shielded PER {labels.borrow} balance. You
                  cannot deposit more than that from private balance.
                </p>
                <Button
                  disabled={lendDepositPrimaryDisabled}
                  onClick={() => {
                    if (!anchorWallet || !deskSnap) return;
                    setErr(null);
                    const rawBig = humanTokenToRaw(
                      lendAmount.trim(),
                      USDC_DECIMALS,
                    );
                    if (
                      rawBig === null ||
                      rawBig < BigInt(1) ||
                      rawBig > BigInt(Number.MAX_SAFE_INTEGER)
                    ) {
                      setErr("Enter a valid amount.");
                      return;
                    }
                    if (
                      lendMaxShieldedRaw === null ||
                      rawBig > lendMaxShieldedRaw
                    ) {
                      setErr(
                        `Amount exceeds shielded ${labels.borrow}. Shield more on the Shield tab first.`,
                      );
                      return;
                    }
                    const raw = new BN(rawBig.toString());
                    const lpToMint = computeLpMintedForDeposit(
                      raw,
                      deskSnap.totalDeposits,
                      deskSnap.lpTotalMinted,
                    );
                    void runWithEr("Deposit liquidity…", () =>
                      depositLiquidity({
                        connection,
                        wallet: anchorWallet,
                        signMessage: signMessageSafe,
                        rawIdl,
                        amount: raw,
                        lpToMint,
                      }),
                    );
                  }}
                >
                  Deposit liquidity
                </Button>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Withdraw LP</Label>
                <Input
                  value={withdrawLpIn}
                  onChange={(e) => setWithdrawLpIn(e.target.value)}
                  disabled={formDisabled || lenderNeedsActivate}
                />
                <Button
                  variant="secondary"
                  disabled={formDisabled || lenderNeedsActivate}
                  onClick={() => {
                    if (!anchorWallet) return;
                    const raw = toRawAmount(withdrawLpIn, portfolio.lpDecimals);
                    if (raw.lte(new BN(0))) return;
                    void runWithEr("Withdraw LP…", () =>
                      withdrawLp({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        shares: raw,
                      }),
                    );
                  }}
                >
                  Withdraw LP
                </Button>
              </div>
              {portfolio.lender && (
                <p className="text-muted-foreground text-xs">
                  Lender deposit (notional):{" "}
                  {formatRaw(portfolio.lender.depositAmount, portfolio.borrowDecimals)}{" "}
                  · LP:{" "}
                  {formatRaw(portfolio.lender.lpShares, portfolio.lpDecimals)}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="borrow" className="w-full min-w-0 space-y-4">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Borrow against shielded {labels.collateral}</CardTitle>
              <CardDescription>
                Deposit collateral and borrow {labels.borrow} on the rollup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {borrowerNeedsActivate && (
                <Button
                  disabled={formDisabled || !anchorWallet || !signMessage}
                  onClick={() =>
                    void runWithEr("Activate borrower…", () =>
                      activatePosition({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        kind: "borrower",
                      }),
                    )
                  }
                >
                  Activate borrower position
                </Button>
              )}
              <div className="space-y-2">
                <Label>Deposit collateral (shielded {labels.collateral})</Label>
                <Input
                  value={depositColIn}
                  onChange={(e) => setDepositColIn(e.target.value)}
                  disabled={formDisabled || borrowerNeedsActivate}
                />
                <Button
                  disabled={formDisabled || borrowerNeedsActivate}
                  onClick={() => {
                    if (!anchorWallet) return;
                    const raw = toRawAmount(
                      depositColIn,
                      portfolio.collateralDecimals,
                    );
                    if (raw.lte(new BN(0))) return;
                    void runWithEr("Deposit collateral…", () =>
                      depositCollateral({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        amount: raw,
                      }),
                    );
                  }}
                >
                  Deposit collateral
                </Button>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Borrow {labels.borrow}</Label>
                <Input
                  value={borrowWantIn}
                  onChange={(e) => setBorrowWantIn(e.target.value)}
                  disabled={formDisabled || borrowerNeedsActivate}
                />
                <p className="text-muted-foreground text-xs">
                  Max by LTV + liquidity:{" "}
                  {deskSnap
                    ? formatRaw(
                      borrowDerived.maxBorrowAllowedRaw,
                      portfolio.borrowDecimals,
                    )
                    : "—"}
                </p>
                <Button
                  disabled={formDisabled || borrowerNeedsActivate}
                  onClick={() => {
                    if (!anchorWallet) return;
                    const amt = borrowDerived.effBorrow;
                    if (amt.lte(new BN(0))) return;
                    void runWithEr("Borrow…", () =>
                      borrow({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        amount: amt,
                      }),
                    );
                  }}
                >
                  Borrow
                </Button>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Repay {labels.borrow}</Label>
                <Input
                  value={repayIn}
                  onChange={(e) => setRepayIn(e.target.value)}
                  disabled={formDisabled || borrowerNeedsActivate}
                />
                <Button
                  variant="secondary"
                  disabled={formDisabled || borrowerNeedsActivate}
                  onClick={() => {
                    if (!anchorWallet) return;
                    const raw = toRawAmount(repayIn, portfolio.borrowDecimals);
                    if (raw.lte(new BN(0))) return;
                    void runWithEr("Repay…", () =>
                      repay({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        amount: raw,
                      }),
                    );
                  }}
                >
                  Repay
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Withdraw collateral</Label>
                <Input
                  value={withdrawColIn}
                  onChange={(e) => setWithdrawColIn(e.target.value)}
                  disabled={formDisabled || borrowerNeedsActivate}
                />
                <Button
                  variant="outline"
                  disabled={formDisabled || borrowerNeedsActivate}
                  onClick={() => {
                    if (!anchorWallet) return;
                    const raw = toRawAmount(
                      withdrawColIn,
                      portfolio.collateralDecimals,
                    );
                    if (raw.lte(new BN(0))) return;
                    void runWithEr("Withdraw collateral…", () =>
                      withdrawCollateral({
                        connection,
                        wallet: anchorWallet!,
                        signMessage: signMessageSafe,
                        rawIdl,
                        amount: raw,
                      }),
                    );
                  }}
                >
                  Withdraw collateral
                </Button>
              </div>
              {portfolio.position && (
                <div className="text-muted-foreground text-xs space-y-1">
                  <div>
                    Collateral:{" "}
                    {formatRaw(
                      portfolio.position.collateralAmount,
                      portfolio.collateralDecimals,
                    )}
                  </div>
                  <div>
                    Debt:{" "}
                    {formatRaw(
                      portfolio.position.debtAmount,
                      portfolio.borrowDecimals,
                    )}
                  </div>
                  {portfolio.position.isLiquidatable && (
                    <Badge variant="destructive">Liquidatable</Badge>
                  )}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={formDisabled || borrowerNeedsActivate}
                onClick={() => {
                  if (!anchorWallet) return;
                  void runWithEr("Close borrower…", () =>
                    closePosition({
                      wallet: anchorWallet!,
                      signMessage: signMessageSafe,
                      rawIdl,
                      kind: "borrower",
                    }),
                  );
                }}
              >
                Close borrower (zero debt & collateral)
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-muted-foreground text-center text-xs">
        Program: {programId.toBase58().slice(0, 8)}… · Desk:{" "}
        {deskPda.toBase58().slice(0, 8)}…
      </p>
    </div>
  );
}
