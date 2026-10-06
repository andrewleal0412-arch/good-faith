// A property's five tabs and their addresses. On their own (no imports), so the tabs' client pieces and the loading
// skeleton can use them without pulling in the rule packs.

export type TabKey = "overview" | "move-out" | "payments" | "documents" | "tenants";
export const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "move-out", label: "Move-out" },
  { key: "payments", label: "Payments" },
  { key: "documents", label: "Documents" },
  { key: "tenants", label: "Tenants" },
];

/** The tab a ?tab= value names, Overview for anything else. */
export const tabOf = (v: unknown): TabKey => (TABS.some((x) => x.key === v) ? (v as TabKey) : "overview");

export const tabHref = (id: string, tab: TabKey, hash = "") => `/tenancy/${id}${tab === "overview" ? "" : `?tab=${tab}`}${hash ? `#${hash}` : ""}`;
