import { Icon } from "@/components/icons";

// What a tenant sees for a link that is mistyped, replaced or turned off. One page for all three: it says nothing
// about which, or about whether a tenancy sits behind the address.
export default function TenantLinkNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col items-center px-5 pt-24 text-center sm:pt-32">
        <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3"><Icon name="link" className="size-[18px]" /></span>
        <h1 className="mt-4 text-xl font-medium">This link doesn&apos;t open anything</h1>
        <p className="mt-2 max-w-sm text-ink-3">It may be incomplete, replaced by a newer link, or turned off. Ask your landlord for a current one.</p>
      </main>
      <footer className="pb-8 text-center text-xs text-ink-3">Prepared with <span className="font-medium text-ink-2">Good Faith</span></footer>
    </div>
  );
}
