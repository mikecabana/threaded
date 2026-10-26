import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AccentAurora } from "@/components/motion/accent-aurora";

/** First sign-in: no navigation, just the moment. */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <AccentAurora />
      <header className="relative px-5 py-5 sm:px-8">
        <Link href="/home" aria-label="Threaded home">
          <Logo />
        </Link>
      </header>
      <main className="relative flex-1 px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
