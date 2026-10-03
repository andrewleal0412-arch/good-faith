"use client";

import { Button } from "@/components/button";
import { Icon } from "@/components/icons";

/** Prints the draft as a plain document (the app chrome is hidden in print). On a phone it is the icon alone. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} aria-label="Print" className="max-sm:w-[34px] max-sm:px-0">
      <Icon name="printer" /><span className="max-sm:sr-only">Print</span>
    </Button>
  );
}
