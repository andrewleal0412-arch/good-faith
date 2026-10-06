import NextLink from "next/link";
import type { ComponentProps } from "react";

// Every in-app link, never prefetched unless it asks to be. Every landlord page reads the database on each request,
// so a prefetch could bring only the page's loading skeleton, which the app shell draws the moment a link is clicked
// anyway (app-shell.tsx); and on the hosted demo's small server each prefetch cost about what a page costs: a
// Properties page started 24 of them (docs/PERFORMANCE.md).
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
