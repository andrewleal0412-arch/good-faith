// What a tenant sees for a link that is mistyped, replaced or turned off. One page for all three: it says nothing
// about which, or about whether a tenancy sits behind the address.
export default function TenantLinkNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-16">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-3">Tenant link</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em]">This link doesn&apos;t open anything</h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-2">
        It may have been pasted incompletely, replaced by a newer link, or turned off. Ask your landlord for a current one.
      </p>
    </main>
  );
}
