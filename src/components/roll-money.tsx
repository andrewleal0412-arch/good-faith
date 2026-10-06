"use client";

import { DUR, useRoll } from "./motion";
import { Money } from "./ui";

/** An amount that counts to its new figure when it changes while it is seen, and lands on the exact figure (useRoll in
 *  motion.tsx): a hero (owed back, the deductions, Deposits held) over the moment's length, a figure beside it or a
 *  tile's total (`quick`) over the slow token, so clicking through filters reads calm. A screen reader reads the final
 *  figure the whole time; at rest, and on every first paint, it is the plain Money. */
export function RollMoney({ quick, ...p }: Parameters<typeof Money>[0] & { quick?: boolean }) {
  const v = useRoll(p.value, quick ? DUR.slow : DUR.moment);
  return (
    <>
      {v != null && <span className="sr-only"><Money {...p} className={undefined} /></span>}
      {v != null ? <span aria-hidden="true"><Money {...p} value={v} /></span> : <Money {...p} />}
    </>
  );
}
