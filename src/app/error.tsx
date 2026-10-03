"use client";

import { useEffect } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/ui";

// A page outside the app shell that failed to load: the refund review or a tenant's page. Generic on purpose, so a
// tenant's page says nothing about the landlord's records.
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 pt-24 sm:pt-32">
      <EmptyState heading tone="red" icon="alert" title="This page didn't load"
        sub="Something went wrong. Try again in a moment."
        action={<Button onClick={() => retry()}>Try again</Button>} />
    </main>
  );
}
