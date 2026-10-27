import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { DemoButton } from "./demo-button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-border/60 border-b bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Threaded home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-muted text-sm md:flex">
          <a href="/#how" className="hover:text-fg">
            How it works
          </a>
          <a href="/#features" className="hover:text-fg">
            Features
          </a>
          <a href="/#goals" className="hover:text-fg">
            Goals
          </a>
          <a href="/#pricing" className="hover:text-fg">
            Pricing
          </a>
          <a href="/#faq" className="hover:text-fg">
            FAQ
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/connect">Sign in</Link>
          </Button>
          <DemoButton size="sm">Try the demo</DemoButton>
        </div>
      </div>
    </header>
  );
}
