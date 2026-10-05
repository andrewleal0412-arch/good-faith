import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/button";
import { FormField } from "@/components/field";
import { Card, EmptyState, inputClass, Notice, Wordmark } from "@/components/ui";
import { ACCESS_MESSAGES, gate, safeNext } from "@/lib/session";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Access", robots: { index: false, follow: false } };

// The hosted demo's front door (src/proxy.ts sends every page here without a session): the wordmark, what the app is,
// one field and one button. The form posts to /api/access, which sets the session and goes on to the page asked for,
// or comes back here with ?e= and a plain message. With no code set on a production host this page says the demo is
// not configured, at whatever address was asked for.

const ERRORS: Record<string, string> = {
  wrong: ACCESS_MESSAGES.wrong,
  throttled: ACCESS_MESSAGES.throttled,
  unconfigured: ACCESS_MESSAGES.unconfigured,
  ended: ACCESS_MESSAGES.signedOut,
  copies: ACCESS_MESSAGES.copiesAddress,
  copies_total: ACCESS_MESSAGES.copiesTotal,
  copy_failed: ACCESS_MESSAGES.copyFailed,
};

export default async function AccessPage({ searchParams }: PageProps<"/access">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const g = gate();
  // Nothing to enter when the gate is off (local dev), or when this browser already has a session and its workspace
  // (a demo copy that has been swept needs the code again).
  if (g.mode === "off" || (g.mode === "on" && (await currentWorkspace().catch(() => null)))) redirect(next);
  const error = typeof sp.e === "string" ? ERRORS[sp.e] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <main className="flex flex-1 justify-center px-4 pb-16 pt-16 sm:pt-28">
        <div className="w-[400px] max-w-full">
          <Wordmark />
          <p className="mt-1.5 text-balance text-base text-ink-3">Security deposits from move-in to refund in five states, with PayPal.</p>
          {g.mode === "unconfigured" ? (
            <Card className="mt-6">
              <EmptyState heading tone="gray" icon="alert" title="This demo is not configured"
                sub="The host hasn't set an access code yet, so nothing here opens." />
            </Card>
          ) : (
            <Card className="mt-6 p-5">
              <form method="post" action="/api/access" className="flex flex-col gap-4">
                <FormField label="Access code">
                  <input name="code" type="password" required autoFocus autoComplete="one-time-code" spellCheck={false}
                    maxLength={200} className={inputClass} aria-invalid={error ? true : undefined} />
                </FormField>
                {error && <Notice>{error}</Notice>}
                {next !== "/" && <input type="hidden" name="next" value={next} />}
                <Button type="submit" variant="primary" size="lg" className="w-full">Enter demo</Button>
              </form>
            </Card>
          )}
        </div>
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-ink-3">PayPal sandbox only. No real money moves. Not legal advice.</footer>
    </div>
  );
}
