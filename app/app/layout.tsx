import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const figtree = Figtree({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Haven: SOL / USDC",
  description: "Supply USDC for yield or borrow USDC against SOL.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("dark", "h-full", "antialiased", "font-sans", figtree.variable)}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
