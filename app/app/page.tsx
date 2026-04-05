"use client";

import { ConfidentialLendingDeskView } from "@/components/confidential-lending-desk-view";
import { useConfidentialLendingDesk } from "@/hooks/use-confidential-lending-desk";

export default function Home() {
  const desk = useConfidentialLendingDesk();
  return <ConfidentialLendingDeskView desk={desk} />;
}
