import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <LogoMark className="size-10" />
      <h1 className="mt-6 font-semibold text-2xl tracking-tight">This thread doesn't exist</h1>
      <p className="mt-2 text-muted">The page you're looking for was moved or never posted.</p>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">Back to Threaded</Link>
      </Button>
    </main>
  );
}
