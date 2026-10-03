import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { LeaseCheck } from "./lease-check";

export const metadata: Metadata = { title: "Check a lease" };

// Check a lease: the way every property comes in. Upload the lease, Claude reads the deposit terms and the state the
// property is in, that state's rule pack flags what breaks its law, and the tenancy starts from it. The four steps,
// the law behind them and the three facts under the check speak for the lease's state (California's until one is
// read); a state with no pack is refused by name (src/lib/states/).

export default function LeasePage() {
  return (
    <div className="max-w-[880px]">
      <PageHead title="Check a lease" sub="Nothing is saved until you start the tenancy." />
      <LeaseCheck />
    </div>
  );
}
