import type { ReactNode } from "react";
import { pageTenancy } from "@/lib/workspace";

// The refund review answers 404 for a tenancy that doesn't exist or is another workspace's before its skeleton
// streams (loading.tsx, which this layout wraps): after that the status can no longer change.
export default async function RefundLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  await pageTenancy((await params).id);
  return children;
}
