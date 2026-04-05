"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";
import usdcIcon from "../public/usdc.png";

export const SOL_ICON_SRC = "/solana.svg";

export function UsdcIcon({ className }: { className?: string }) {
  return (
    <Image
      src={usdcIcon}
      alt=""
      width={32}
      height={32}
      className={cn("size-5 shrink-0 object-contain", className)}
      aria-hidden
    />
  );
}

export function TokenIcon({
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
