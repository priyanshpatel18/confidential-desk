import {
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

export type ParsedPerUnsignedWire =
  | { kind: "legacy"; tx: Transaction }
  | { kind: "v0"; tx: VersionedTransaction };

export function parsePerUnsignedWire(b64: string): ParsedPerUnsignedWire {
  const buf = Buffer.from(b64, "base64");
  try {
    const legacy = Transaction.from(buf);
    return { kind: "legacy", tx: legacy };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m.includes("Versioned messages must be deserialized")) {
      return { kind: "v0", tx: VersionedTransaction.deserialize(buf) };
    }
    throw e;
  }
}
