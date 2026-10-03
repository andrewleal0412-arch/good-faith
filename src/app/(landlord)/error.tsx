"use client";

import { useEffect } from "react";
import { Button } from "@/components/button";
import { Card, EmptyState } from "@/components/ui";

// A page that failed to load (the database or PayPal didn't answer), inside the app shell, which renders on its own.
// The message stays generic: in production a server error reaches the browser only as a digest.
export default function LandlordError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <Card>
      <EmptyState heading tone="red" icon="alert" title="This page didn't load"
        sub="Something went wrong on our side. Nothing was changed."
        action={<Button onClick={() => retry()}>Try again</Button>} />
    </Card>
  );
}
