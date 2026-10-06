import type { ReactNode } from "react";
import { tabOf } from "@/lib/tenancy-tabs";
import { DocumentPageSkeleton, DocumentsSkeleton, InsightsSkeleton, LeaseSkeleton, MoveOutsSkeleton, PaymentsSkeleton, PropertiesSkeleton, RefundSkeleton, TenancySkeleton, TenantsSkeleton } from "./skeletons";

/** The skeleton of the landlord page at this address (a path, with its query), or null for an address outside the app
 *  shell (the refund review, the access page, the tenants' page) or one it doesn't know. The app shell draws it the
 *  moment a link is clicked (app-shell.tsx), and the landlord layout streams it first on a full load (RouteSkeleton). */
export function skeletonFor(address: string): ReactNode | null {
  const [path, query = ""] = address.split("?");
  switch (path) {
    case "/": case "/units": return <PropertiesSkeleton />;
    case "/tenants": return <TenantsSkeleton />;
    case "/ledger": return <PaymentsSkeleton />;
    case "/insights": return <InsightsSkeleton />;
    case "/documents": return <DocumentsSkeleton />;
    case "/lease": return <LeaseSkeleton />;
    case "/move-outs": return <MoveOutsSkeleton />;
  }
  const m = path.match(/^\/tenancy\/[0-9a-f-]{36}(\/statement|\/notices\/[a-z-]+)?$/i);
  if (!m) return null;
  if (!m[1]) return <TenancySkeleton tab={tabOf(new URLSearchParams(query).get("tab"))} />;
  return m[1] === "/statement" ? <DocumentPageSkeleton title="Itemized statement" facts /> : <DocumentPageSkeleton title="Notice" />;
}

/** The skeleton of a focused flow outside the shell (the refund review, its own full page), drawn over the shell while
 *  it opens; null for anything else. */
export function flowSkeletonFor(address: string): ReactNode | null {
  return /^\/tenancy\/[0-9a-f-]{36}\/refund$/i.test(address.split("?")[0]) ? <RefundSkeleton /> : null;
}
