import type { ReactNode } from "react";
import { TABS } from "@/lib/tenancy-tabs";
import { Card, CardHead, FactStrip, Wordmark } from "./ui";

// The loading state of every landlord route: the page's own frame (its title, its cards, its table) in gray bones, so a
// click shows the destination at once and the data fills in where it will stand. The app shell draws one the moment a
// link is clicked (app-shell.tsx), before the server has answered, and the landlord layout streams one first on a
// full page load (route-skeleton.tsx); the refund review's loading.tsx has its own.
// Server-safe (no hooks). The root carries data-skeleton (the timing checks wait for it to go), aria-busy, and one
// status line for a screen reader. A skeleton is there in the frame of the click, never easing in (gf-still marks the
// parts of a property's skeleton outside its root); a soft light passes over the bones after a short delay, never
// with reduced motion (globals.css).

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** One gray bone: a line of text, a button, a photo. */
export function Bone({ w, h = 12, className }: { w?: number | string; h?: number; className?: string }) {
  return <span aria-hidden className={cx("gf-bone block shrink-0", className)} style={{ width: w ?? "100%", height: h }} />;
}

/** The root of a skeleton. */
export function Skeleton({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div data-skeleton="" aria-busy="true" className={className}>
      <span role="status" className="sr-only">Loading {label}</span>
      {children}
    </div>
  );
}

const ButtonBone = ({ w }: { w: number }) => <Bone w={w} h={34} className="rounded-md" />;

/** A page head with its real title, and bones where its buttons go. */
function Head({ title, buttons = [], sub }: { title: string; buttons?: number[]; sub?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-medium">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-3">{sub}</p>}
      </div>
      {buttons.length > 0 && <div className="ml-auto flex items-center gap-2">{buttons.map((w, i) => <ButtonBone key={i} w={w} />)}</div>}
    </div>
  );
}

/** The facts strip: a label, a value and a sub line per cell. */
function Facts({ cols, className }: { cols: 3 | 4; className?: string }) {
  return (
    <FactStrip cols={cols} className={className}>
      {Array.from({ length: cols }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 px-3 py-2.5 sm:px-5 sm:py-3.5">
          <Bone w={72} />
          <Bone w={i === 0 ? 132 : 104} h={24} />
          <Bone w={84} />
        </div>
      ))}
    </FactStrip>
  );
}

/** Table rows inside a card: a header line, then rows of 48px with a title, a sub line and a couple of cells. */
function Rows({ n, thumb, cells = 2, head = true }: { n: number; thumb?: boolean; cells?: number; head?: boolean }) {
  return (
    <div>
      {head && (
        <div className="flex h-10 items-center gap-6 border-b border-line px-5">
          <Bone w={90} h={10} />
          {Array.from({ length: cells }, (_, i) => <Bone key={i} w={64} h={10} className="max-sm:hidden" />)}
        </div>
      )}
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 border-b border-line-2 px-5 py-3 last:border-b-0">
          {thumb && <Bone w={36} h={36} className="rounded-sm" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Bone w={`${58 - (i % 3) * 9}%`} h={13} />
            <Bone w={`${36 - (i % 2) * 8}%`} h={10} />
          </div>
          {Array.from({ length: cells }, (_, j) => <Bone key={j} w={j === 0 ? 76 : 92} h={j === 0 ? 13 : 22} className={cx(j > 0 && "rounded-sm", j > 0 && "max-sm:hidden")} />)}
        </div>
      ))}
    </div>
  );
}

/** List rows (a title, a sub line, something on the right), as in Recent activity. */
function ListBones({ n }: { n: number }) {
  return (
    <div className="px-5 py-1">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-2 py-[11px] last:border-b-0">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5"><Bone w={`${62 - (i % 3) * 10}%`} h={13} /><Bone w="34%" h={10} /></div>
          <Bone w={44} h={12} />
        </div>
      ))}
    </div>
  );
}

const StepBones = ({ n }: { n: number }) => (
  <div className="flex flex-col gap-2 p-4">{Array.from({ length: n }, (_, i) => <Bone key={i} h={58} className="rounded-md" />)}</div>
);

/* ---------- Routes ---------- */

export function PropertiesSkeleton() {
  return (
    <Skeleton label="Properties">
      <Head title="Properties" buttons={[124]} />
      <div className="mb-6 flex flex-wrap gap-2"><ButtonBone w={126} /><ButtonBone w={142} /><ButtonBone w={128} /></div>
      <Facts cols={3} className="mb-6" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0">
          <Bone w={276} h={36} className="mb-3.5 max-w-full rounded-md" />
          <Card className="hidden lg:block"><Rows n={4} thumb cells={3} /></Card>
          <div className="flex flex-col gap-2.5 lg:hidden">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="flex items-start gap-3 p-3.5">
                <Bone w={48} h={48} className="rounded-sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-2"><Bone w="68%" h={14} /><Bone w="44%" /><Bone w="56%" h={30} /><Bone w="100%" h={22} /></div>
              </Card>
            ))}
          </div>
          <Card className="mt-6"><CardHead title="Recent activity" /><ListBones n={5} /></Card>
        </div>
        <div className="flex flex-col gap-4 max-xl:order-first md:max-xl:grid md:max-xl:grid-cols-2 md:max-xl:items-start">
          <Card><CardHead title="Next steps" /><StepBones n={3} /></Card>
          <Card className="flex flex-col gap-2.5 p-5"><Bone w={150} h={14} /><Bone w={110} /><Bone w={120} h={28} /><Bone w={90} /></Card>
        </div>
      </div>
    </Skeleton>
  );
}

export function TenantsSkeleton() {
  return (
    <Skeleton label="Tenants">
      <Head title="Tenants" />
      <Card><Rows n={6} cells={3} /></Card>
    </Skeleton>
  );
}

export function PaymentsSkeleton() {
  return (
    <Skeleton label="Payments">
      <Head title="Payments" buttons={[96, 76, 150]} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => <Card key={i} className="flex flex-col gap-2 px-5 py-4"><Bone w={110} /><Bone w={140} h={28} /><Bone w={160} /></Card>)}
      </div>
      <div className="flex h-[38px] items-end gap-5 border-b border-line">{[64, 72, 58, 80, 66].map((w, i) => <Bone key={i} w={w} h={14} className="mb-3" />)}</div>
      <div className="mb-3.5 mt-5 flex flex-wrap gap-2"><Bone w={220} h={30} className="rounded-md max-sm:w-full" /><Bone w={110} h={30} className="rounded-sm" /><Bone w={104} h={30} className="rounded-sm" /><Bone w={92} h={30} className="rounded-sm" /></div>
      <Card><Rows n={7} cells={3} /></Card>
    </Skeleton>
  );
}

export function InsightsSkeleton() {
  return (
    <Skeleton label="Insights">
      <Head title="Insights" buttons={[118]} />
      <Bone w={300} h={34} className="mb-5 max-w-full rounded-md" />
      <Facts cols={4} className="mb-6" />
      <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[300px] rounded-lg border border-line bg-surface" />)}</div>
      <Card className="mt-6"><CardHead title="Properties" /><Rows n={5} cells={3} /></Card>
    </Skeleton>
  );
}

export function DocumentsSkeleton() {
  return (
    <Skeleton label="Documents">
      <Head title="Documents" />
      <Card>
        {[0, 1].map((g) => (
          <div key={g}>
            <div className="flex h-9 items-center border-y border-line-2 bg-surface px-5 first:border-t-0"><Bone w={180} h={11} /></div>
            <Rows n={4} cells={2} head={false} />
          </div>
        ))}
      </Card>
    </Skeleton>
  );
}

export function LeaseSkeleton() {
  return (
    <Skeleton label="Check a lease" className="max-w-[880px]">
      <Head title="Check a lease" sub="Nothing is saved until you start the tenancy." />
      <Card className="flex flex-col items-center gap-3 px-6 py-12"><Bone w={40} h={40} className="rounded-full" /><Bone w={200} h={14} /><Bone w={260} /><ButtonBone w={130} /></Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Card key={i} className="flex flex-col gap-2 p-5"><Bone w={90} /><Bone w="80%" h={14} /></Card>)}</div>
    </Skeleton>
  );
}

export function MoveOutsSkeleton() {
  return (
    <Skeleton label="Move-outs">
      <Head title="Move-outs" />
      <Bone w={170} h={36} className="mb-3.5 rounded-md" />
      <Card><Rows n={3} thumb cells={3} /></Card>
    </Skeleton>
  );
}

/** The record header of a property: back, photo, address and status, the buttons. */
export function RecordHeadSkeleton() {
  return (
    <div className="gf-still flex flex-wrap items-center gap-x-4 gap-y-3">
      <Bone w={32} h={32} className="rounded-full max-sm:self-start" />
      <Bone w={64} h={64} className="rounded-md max-sm:hidden" />
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-2"><div className="flex items-center gap-3"><Bone w={230} h={26} className="max-w-[70%]" /><Bone w={96} h={26} className="rounded-sm" /></div><Bone w={170} h={14} /></div>
      <div className="flex items-center gap-2 max-sm:w-full"><Bone w={124} h={34} className="rounded-md max-sm:hidden" /><Bone w={132} h={34} className="rounded-md max-sm:flex-1" /><Bone w={34} h={34} className="rounded-md" /></div>
    </div>
  );
}

/** The body of one tenancy tab while it loads, laid out as that tab is. */
export function TabBodySkeleton({ tab }: { tab: string }) {
  if (tab === "move-out") {
    return (
      <Skeleton label="Move-out" className="flex flex-col gap-7">
        <Facts cols={4} />
        <Card><CardHead title="Move-out photos" /><div className="grid gap-4 p-5 sm:grid-cols-2">{[0, 1].map((i) => <Bone key={i} h={180} className="rounded-md" />)}</div></Card>
        <Card><CardHead title="Deductions" /><Rows n={4} cells={1} /></Card>
      </Skeleton>
    );
  }
  if (tab === "payments") return <Skeleton label="Payments"><Card><CardHead title="Payments" /><Rows n={4} cells={2} /></Card></Skeleton>;
  if (tab === "documents") return <Skeleton label="Documents"><Card><Rows n={7} cells={1} /></Card></Skeleton>;
  if (tab === "tenants") {
    return (
      <Skeleton label="Tenants" className="flex flex-col gap-6">
        <Card><CardHead title="Tenants" /><Rows n={2} cells={2} /></Card>
        <Card className="flex flex-col gap-2.5 p-5"><Bone w={120} h={14} /><Bone w="70%" /><ButtonBone w={150} /></Card>
      </Skeleton>
    );
  }
  return (
    <Skeleton label="Overview">
      <Facts cols={4} className="mb-6" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card><CardHead title="Move-in" /><ListBones n={5} /></Card>
          <Card><CardHead title="Activity" /><ListBones n={6} /></Card>
        </div>
        <div className="flex flex-col gap-4 max-lg:order-first">
          <Card><CardHead title="Next step" /><StepBones n={1} /></Card>
          <Card className="flex flex-col gap-2.5 p-5"><Bone w={60} h={14} />{[0, 1, 2].map((i) => <Bone key={i} h={12} />)}</Card>
        </div>
      </div>
    </Skeleton>
  );
}

/** The tab row as it reads, with the tab being opened underlined (not links: the real row replaces it). */
export function TabBarSkeleton({ active }: { active: string }) {
  return (
    <div aria-hidden className="gf-still -mx-4 mb-6 mt-5 flex gap-0.5 overflow-hidden border-b border-line px-4 sm:mx-0 sm:gap-1 sm:px-0">
      {TABS.map((t) => (
        <span key={t.key} className={cx("-mb-px inline-flex h-[38px] shrink-0 items-center border-b-2 px-2 text-sm sm:px-3 sm:text-base",
          t.key === active ? "border-brand font-medium text-ink" : "border-transparent text-ink-3")}>{t.label}</span>
      ))}
    </div>
  );
}

/** A whole property page while it loads: the record header, the tabs, and the open tab's body. */
export function TenancySkeleton({ tab }: { tab: string }) {
  return (
    <>
      <RecordHeadSkeleton />
      <TabBarSkeleton active={tab} />
      <TabBodySkeleton tab={tab} />
    </>
  );
}

/** A statement or a notice: back, the title, the document beside its side cards. */
export function DocumentPageSkeleton({ title, facts }: { title: string; facts?: boolean }) {
  return (
    <Skeleton label={title}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Bone w={32} h={32} className="rounded-full" />
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5"><h1 className="text-xl font-medium">{title}</h1><Bone w={180} h={14} /></div>
        <div className="flex items-center gap-2 max-sm:w-full"><ButtonBone w={76} /><ButtonBone w={150} /></div>
      </div>
      {facts && <Facts cols={4} className="mt-6" />}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex flex-col gap-3 p-5 max-lg:order-3 sm:p-8"><Bone w={140} h={11} /><Bone w="60%" h={24} />{Array.from({ length: 9 }, (_, i) => <Bone key={i} w={`${92 - (i % 4) * 11}%`} h={13} />)}</Card>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2.5 p-5"><Bone w={110} h={14} /><Bone w="80%" /><ButtonBone w={140} /></Card>
          <Card className="flex flex-col gap-2.5 p-5"><Bone w={90} h={14} />{[0, 1, 2, 3].map((i) => <Bone key={i} w="88%" />)}</Card>
        </div>
      </div>
    </Skeleton>
  );
}

/** The focused refund review: the wordmark bar and the 560px column. */
export function RefundSkeleton() {
  return (
    <Skeleton label="the refund" className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 items-center gap-3.5 px-4 sm:px-8"><Wordmark /><span aria-hidden className="h-5 w-px shrink-0 bg-line" /><Bone w={140} h={14} /></header>
      <main className="flex flex-1 justify-center px-4 pb-20 pt-6 sm:px-8 sm:pt-16">
        <div className="flex w-[560px] max-w-full flex-col gap-3">
          <Bone w={200} h={28} /><Bone w="70%" h={14} /><Bone w={180} h={40} /><Bone w="85%" h={14} />
          <Card className="mt-5 flex flex-col gap-5 p-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-4"><Bone w={104} h={13} /><Bone w="55%" h={13} /></div>)}</Card>
          <Bone w="100%" h={40} className="mt-4 rounded-md" />
        </div>
      </main>
    </Skeleton>
  );
}
