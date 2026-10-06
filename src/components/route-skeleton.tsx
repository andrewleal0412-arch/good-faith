"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { skeletonFor } from "./skeleton-route";

/** The skeleton of the landlord page at the current address: what the app shell's layout streams first, while the page
 *  reads its data (src/app/(landlord)/layout.tsx). */
export function RouteSkeleton() {
  const query = useSearchParams().toString();
  return <>{skeletonFor(`${usePathname()}${query ? `?${query}` : ""}`)}</>;
}
