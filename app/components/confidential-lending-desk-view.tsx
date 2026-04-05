"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { BalancesCard } from "./balances-card";
import { BorrowTab } from "./borrow-tab";
import { SOL_ICON_SRC, TokenIcon, UsdcIcon } from "./desk-icons";
import { LendTab } from "./lend-tab";
import { PrivateSendTab } from "./private-send-tab";
import { ShieldTab } from "./shield-tab";

export function ConfidentialLendingDeskView({
  desk,
}: {
  desk: ConfidentialLendingDeskModel;
}) {
  const {
    cluster,
    labels,
    programId,
    deskPda,
    mainTab,
    setMainTab,
    deskReady,
    deskOnline,
    err,
    setErr,
  } = desk;

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

      {err && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{err}</span>
            <button
              type="button"
              className="text-sm underline underline-offset-2"
              onClick={() => setErr(null)}
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      <BalancesCard desk={desk} />

      {!deskOnline && deskReady !== null && (
        <Alert>
          <AlertTitle>Desk offline</AlertTitle>
          <AlertDescription>
            No desk account for this mint pair on the current RPC. Initialize the
            program on-chain first.
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={mainTab}
        onValueChange={(v) => setMainTab(v as typeof mainTab)}
        className="w-full min-w-0"
      >
        <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger value="shield">Shield / Unshield</TabsTrigger>
          <TabsTrigger value="privateSend">Private send</TabsTrigger>
          <TabsTrigger value="lend">Lend</TabsTrigger>
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
        </TabsList>

        <TabsContent value="shield" className="w-full min-w-0 space-y-4">
          <ShieldTab desk={desk} />
        </TabsContent>

        <TabsContent value="privateSend" className="w-full min-w-0 space-y-4">
          <PrivateSendTab desk={desk} />
        </TabsContent>

        <TabsContent value="lend" className="w-full min-w-0 space-y-4">
          <LendTab desk={desk} />
        </TabsContent>

        <TabsContent value="borrow" className="w-full min-w-0 space-y-4">
          <BorrowTab desk={desk} />
        </TabsContent>
      </Tabs>

      <p className="text-muted-foreground text-center text-xs">
        Program: {programId.toBase58().slice(0, 8)}… · Desk:{" "}
        {deskPda.toBase58().slice(0, 8)}…
      </p>
    </div>
  );
}
