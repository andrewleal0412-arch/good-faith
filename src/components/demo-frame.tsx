import "server-only";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { DemoStrip, GuideBar } from "./guide-bar";
import { BAR_COOKIE, SEEN_COOKIE, seenBeats, type GuideSide } from "@/lib/demo-guide";
import { demoGuideSteps, demoSide } from "@/lib/demo-guide-server";

// A page of a private demo copy that has no landlord top bar (the tenants' pages, the refund review): the strip with
// the Landlord | Tenants switch above it, and the next-step bar at its foot (components/guide-bar.tsx). The caller
// decides that the page is a demo copy's; both reads stream in after the page's first paint.

/** Never fails: a read that can't be done leaves its part out, and the page is as it would be without the demo. */
const quiet = <T,>(p: Promise<T>, what: string) => p.catch((e) => { console.error(`Demo frame: couldn't load ${what}`, e); return null; });

export async function DemoFrame({ side, children }: { side: GuideSide; children: ReactNode }) {
  const jar = await cookies();
  const steps = quiet(demoGuideSteps(seenBeats(jar.get(SEEN_COOKIE)?.value)), "the demo guide");
  const demo = quiet(demoSide(), "the Landlord | Tenants switch");
  return (
    <>
      <DemoStrip side={side} demo={demo} />
      {children}
      <GuideBar steps={steps} hidden={jar.get(BAR_COOKIE)?.value === "off"} column="max-w-[600px] sm:px-5" />
    </>
  );
}
