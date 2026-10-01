import { LeaseCheck } from "./lease-check";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Deposit Agent</p>
      <h1 className="mt-2 text-[34px] sm:text-[40px] font-semibold leading-[1.1] tracking-[-0.02em]">
        California security deposits, from move-in to refund.
      </h1>
      <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-ink-2">
        Upload the lease. The agent reads the deposit terms and checks them against Civil Code 1950.5 as it
        stands in 2026, with the statute behind every flag.
      </p>
      <LeaseCheck />
      <p className="mt-10 text-[12px] leading-relaxed text-ink-3">
        This tool organizes records and fills in templates based on California Civil Code 1950.5 and published state
        guidance. It does not give legal advice and is not a substitute for a California attorney.
      </p>
    </main>
  );
}
