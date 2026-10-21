import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <ComingSoon
      icon={<CalendarClock />}
      title="Queue"
      description="Schedule posts into your best time slots and see how each one performed."
      features={[
        "Week calendar shaded by your best hours",
        "Drag a saved idea onto a slot to schedule it",
        "Posts publish on time, with alerts if anything goes wrong",
        "A scorecard for every post Threaded helped write",
      ]}
    />
  );
}
