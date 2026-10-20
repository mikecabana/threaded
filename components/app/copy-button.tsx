"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function CopyButton({ text, ...props }: ButtonProps & { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }}
      {...props}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={copied ? "done" : "copy"}
          className="flex"
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
        >
          {copied ? <Check className="text-positive" /> : <Copy />}
        </m.span>
      </AnimatePresence>
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
