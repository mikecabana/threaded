"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { startDemoAction } from "@/lib/actions/demo";
import type { DemoPersonaId } from "@/lib/demo/personas";

function Submit({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {children}
      {pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
    </Button>
  );
}

/** Starts a demo session (no Threads login) and lands on Home. */
export function DemoButton({
  persona = "creator",
  children = "Try a demo account",
  ...props
}: ButtonProps & { persona?: DemoPersonaId }) {
  return (
    <form action={startDemoAction}>
      <input type="hidden" name="persona" value={persona} />
      <Submit {...props}>{children}</Submit>
    </form>
  );
}
