import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHead, StatusChip, Table, Td, Th, trClass } from "@/components/ui";
import { db } from "@/lib/db";
import { pacificDate, shortDate } from "@/lib/dates";
import { propertyStatus, splitAddress, tabHref } from "@/lib/property-view";
import { packFor, refundRecordWords } from "@/lib/states";
import { loadUnits } from "@/lib/units";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tenants" };

// Every tenant on every lease: where they live, the refund agreement (or, where the state asks for none, the refund
// account) they signed and the PayPal account it names.
export default async function TenantsPage() {
  const ws = await currentWorkspace();
  const [{ units }, { data }] = await Promise.all([
    loadUnits(),
    ws ? db.from("tenancies").select("id, tenants, refund_agreement").eq("workspace_id", ws.id) : Promise.resolve({ data: [] }),
  ]);
  const extra = new Map(((data ?? []) as { id: string; tenants: { name: string; email: string | null }[] | null; refund_agreement: { paypal_email: string; signed_by: string[]; signed_at: string } | null }[])
    .map((t) => [t.id, t]));
  const rows = units.flatMap((u) => {
    const t = extra.get(u.summary.id);
    const status = propertyStatus(u.summary, u.next);
    const street = splitAddress(u.summary.address, u.summary.city).street;
    const record = refundRecordWords(packFor(u.summary.state));
    return (t?.tenants ?? []).map((c) => ({ id: u.summary.id, name: c.name, email: c.email, street, status, record, agreement: t?.refund_agreement ?? null }));
  });
  // The column names what every row's record is; when the states differ (an agreement in one, an account in another),
  // what they have in common: signed in writing.
  const kinds = new Set(rows.map((r) => r.record.name));
  const recordHead = kinds.size === 1 ? [...kinds][0] : "Refund in writing";

  return (
    <>
      <PageHead title="Tenants" />
      <Card>
        {rows.length ? (
          <>
          {/* Below 1024px, Mercury's list: the name, the property under it, the status on the right. */}
          <ul className="lg:hidden">
            {rows.map((r) => (
              <li key={`${r.id}-${r.name}`} className="border-b border-line-2 last:border-b-0">
                <Link href={tabHref(r.id, "tenants")} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-xs text-ink-3">{r.street}</div>
                  </div>
                  <StatusChip tone={r.status.tone}>{r.status.label}</StatusChip>
                </Link>
              </li>
            ))}
          </ul>
          <div className="max-lg:hidden">
          <Table minWidth={760}>
            <thead><tr><Th first>Tenant</Th><Th>Property</Th><Th>Status</Th><Th>{recordHead}</Th><Th last>Refund to</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const signed = r.agreement?.signed_by.includes(r.name);
                return (
                  <tr key={`${r.id}-${r.name}`} className={trClass}>
                    <Td first>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-ink-3">{r.email ?? "No email on file"}</div>
                    </Td>
                    <Td className="whitespace-nowrap"><Link href={tabHref(r.id, "tenants")} className="hover:underline">{r.street}</Link></Td>
                    <Td><StatusChip tone={r.status.tone}>{r.status.label}</StatusChip></Td>
                    <Td className="whitespace-nowrap">{signed ? `Signed ${shortDate(pacificDate(r.agreement!.signed_at))}` : <span className="text-ink-3">Not signed</span>}</Td>
                    <Td last>{r.agreement ? `PayPal, ${r.agreement.paypal_email}` : <span className="text-ink-3">{r.record.none}</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </div>
          </>
        ) : (
          <EmptyState icon="users" title="No tenants yet" sub="Tenants come in with the lease."
            action={<ButtonLink variant="primary" href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
        )}
      </Card>
    </>
  );
}
