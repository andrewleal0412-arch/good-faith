import "server-only";
import { CA } from "./ca";
import { CA_SERVER } from "./ca.server";
import { FL } from "./fl";
import { FL_SERVER } from "./fl.server";
import { isSupported } from "./index";
import { NY } from "./ny";
import { NY_SERVER } from "./ny.server";
import { TX } from "./tx";
import { TX_SERVER } from "./tx.server";
import type { StateCode, StatePack } from "./types";
import { WA } from "./wa";
import { WA_SERVER } from "./wa.server";

// The whole pack, for server code: each state's ClientPack (<state>.ts) joined to its server half (<state>.server.ts),
// which holds the statement checklist, the close-out agent's rules and prompt, the next-step hooks, the calendar and
// the tenant page. Client components import ./index instead, so none of that ships to the browser; a client module
// that reached this file would fail the build on "server-only".

export * from "./index";
export type { StatePack } from "./types";

const PACKS: Record<StateCode, StatePack> = {
  CA: { ...CA, ...CA_SERVER },
  NY: { ...NY, ...NY_SERVER },
  TX: { ...TX, ...TX_SERVER },
  FL: { ...FL, ...FL_SERVER },
  WA: { ...WA, ...WA_SERVER },
};

/** The whole pack for a state code. Throws for an unsupported one, as ./index's does. */
export function packFor(code: string | null | undefined): StatePack {
  const c = (code ?? "CA").toUpperCase();
  if (!isSupported(c)) throw new Error(`No rule pack for ${c}.`);
  return PACKS[c];
}

/** The one pack every given tenancy follows, or null when they span several states. */
export function onePack(codes: (string | null | undefined)[]): StatePack | null {
  const set = new Set(codes.map((c) => (c ?? "CA").toUpperCase()));
  if (set.size > 1) return null;
  return packFor([...set][0] ?? "CA");
}
