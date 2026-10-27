import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ConsentManager } from "@/components/consent/consent-manager";
import { MotionProvider } from "@/components/motion/motion-provider";
import { consentBootScript } from "@/lib/consent/consent";
import { DEFAULT_GOAL } from "@/lib/goals";
import { indexable, OPEN_GRAPH, siteUrl } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { preferencesScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute URLs (canonicals, Open Graph images) resolve against production.
  metadataBase: siteUrl(),
  title: { default: SITE.title, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: { ...OPEN_GRAPH, title: SITE.title, description: SITE.description, url: "/" },
  twitter: { card: "summary_large_image" },
  // Previews are for us, not search engines.
  robots: indexable() ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-goal={DEFAULT_GOAL}
      // The inline script below rewrites data-theme/data-goal before hydration.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, first-party preferences script */}
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, first-party consent defaults and Tag Manager loader */}
        <script dangerouslySetInnerHTML={{ __html: consentBootScript }} />
      </head>
      <body className="min-h-full bg-bg text-fg">
        <MotionProvider>{children}</MotionProvider>
        <ConsentManager />
      </body>
    </html>
  );
}
