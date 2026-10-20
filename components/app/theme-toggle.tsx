"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: "dark", label: "Dark", icon: <Moon /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "system", label: "System", icon: <Monitor /> },
];

const CHANGE_EVENT = "threaded:theme";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "system" ? stored : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function apply(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode: the theme still applies for this page view.
  }
  const resolved =
    preference === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : preference;
  document.documentElement.dataset.theme = resolved;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle({ className }: { className?: string }) {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "dark" as const);
  return (
    <Segmented
      legend="Theme"
      options={OPTIONS}
      value={preference}
      onChange={apply}
      iconOnly
      activeClassName="text-fg"
      pillClassName="bg-surface-2 ring-1 ring-border-strong"
      className={className}
    />
  );
}
