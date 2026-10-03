import { ButtonLink } from "@/components/button";
import { Card, EmptyState } from "@/components/ui";

// A property, statement or notice that doesn't exist (a mistyped or removed id), inside the app shell.
export default function LandlordNotFound() {
  return (
    <Card>
      <EmptyState heading tone="gray" icon="search" title="Not found"
        sub="This page doesn't exist, or the property was removed."
        action={<ButtonLink href="/units">Back to Properties</ButtonLink>} />
    </Card>
  );
}
