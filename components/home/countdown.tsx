"use client";

import { useEffect, useState } from "react";

function label(target: number, now: number): string {
  const minutes = Math.round((target - now) / 60_000);
  if (minutes <= 0) return "now";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

/** "in 3h 12m", ticking each minute. The server renders the first value. */
export function Countdown({ to, serverNow }: { to: string; serverNow: string }) {
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="tabular" suppressHydrationWarning>
      {label(target, now)}
    </span>
  );
}
