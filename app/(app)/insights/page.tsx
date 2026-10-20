import { ChartColumn } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <ComingSoon
      icon={<ChartColumn />}
      title="Insights"
      description="The full picture of what your audience rewards, explained in plain English."
      features={[
        "Views and follower growth over time, annotated with your posts",
        "Your best hours as a weekly heatmap",
        "Which formats and topics work for each goal",
        "Every post ranked against your own baseline",
        "Audience demographics once your account is eligible",
      ]}
    />
  );
}
