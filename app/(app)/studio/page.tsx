import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return (
    <ComingSoon
      icon={<Sparkles />}
      title="Studio"
      description="Generate post ideas in your voice, aimed at your goal, and watch them stream in as they're written."
      features={[
        "Pick a topic, a spice level and a format, then generate a batch",
        "See the price of every generation before you run it",
        "Each idea explains itself with your own numbers",
        "Edit, regenerate a variant, save, post now or schedule",
        "Swipe to triage on your phone",
      ]}
    />
  );
}
