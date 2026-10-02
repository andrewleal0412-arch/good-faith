"use client";

import { Button } from "@/components/button";

export function PrintButton() {
  return <Button variant="primary" onClick={() => window.print()}>Print</Button>;
}
