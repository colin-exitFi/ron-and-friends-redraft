"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The only interactive thing on the export page. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print
    </Button>
  );
}
