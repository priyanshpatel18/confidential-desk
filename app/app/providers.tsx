"use client";

import "@solana/wallet-adapter-react-ui/styles.css";

import { SolanaWalletProvider } from "@/components/wallet-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
