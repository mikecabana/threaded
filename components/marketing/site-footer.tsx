import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CookieSettingsButton } from "@/components/consent/consent-manager";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-muted text-sm sm:flex-row sm:items-center sm:px-6">
        <Logo className="opacity-80" />
        <nav className="flex flex-wrap gap-5">
          <Link href="/legal/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <CookieSettingsButton className="hover:text-fg" />
          <a href={`mailto:${SITE.contactEmail}`} className="hover:text-fg">
            Contact
          </a>
        </nav>
        <p className="text-subtle sm:ml-auto">Not affiliated with Meta or Threads.</p>
      </div>
    </footer>
  );
}
