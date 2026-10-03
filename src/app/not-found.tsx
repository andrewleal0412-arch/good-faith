import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { EmptyState, Wordmark } from "@/components/ui";

// Any address that matches no page. It sits outside the app shell (the shell reads the database), so it carries only
// the wordmark and one way back.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-14 items-center border-b border-line px-4 md:px-7">
        <Link href="/units"><Wordmark /></Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pt-16 sm:pt-24">
        <EmptyState heading tone="gray" icon="search" title="Page not found"
          sub="The address may be mistyped, or the page was moved."
          action={<ButtonLink href="/units">Go to Properties</ButtonLink>} />
      </main>
    </div>
  );
}
