// The shape every state rule pack has (src/lib/states/<state>.ts). A pack is plain data plus small pure functions, and
// every number, deadline, trigger, required notice, document rule, refund-method rule, penalty and citation the app
// uses for a tenancy comes from the pack of the state its property is in. Each value carries its citation, so the
// Why? tips, the statement and the close-out agent cite the tenancy's own state and nothing else.
//
// Each pack comes in two halves. `<state>.ts` is the ClientPack: what the lease check and the tenancy's client
// components read (tips, labels, records, the lease rules), with no server imports. `<state>.server.ts` is the
// ServerPart: the statement checklist, the close-out agent's rules and prompt, the next-step hooks, the calendar and
// the tenant page. `src/lib/states/server.ts` joins them into the StatePack server code reads, so the prompts and the
// graders never ship to the browser. The imports below are types only.

import type { ReactNode } from "react";
import type { CloseOutFacts } from "../closeout";
import type { Flag, LeaseTerms } from "../rules";
import type { NextStep, TenancySummary } from "../next-step";
import type { NoticeGiven, NoticeMethod, Notices } from "../notices";
import type { ChecklistItem, Statement } from "../statement";
import type { TenantView } from "../tenant-view";

export type StateCode = "CA" | "NY" | "TX" | "FL" | "WA";

/** A rule as a tip shows it: a title, the words, and the citation in the tip's footer. */
export type Tip = { title: string; text: string; cite?: string };

/** What the agent invoices at move-in: everything the lease charges as security, held to the cap. `cap` is null in a
 *  state with no statewide cap. Null when the cap can't be determined yet. */
export type LawfulDeposit = { amount: number; cap: number | null; charged: number };

/** The dates the deadline is computed from. `claimed` and `claimNoticeDate` matter only where a claim on the deposit
 *  changes the deadline (Florida's two tracks). */
export type ClockInput = {
  moveOutDate: string | null;
  endDate: string | null;
  plannedMoveOut: string | null;
  claimed?: boolean;
  claimNoticeDate?: string | null;
};

/** A record the landlord keeps at a point the state's law names: a notice given, a checklist signed, the account the
 *  deposit is held in, the tenant's written forwarding address, a claim notice. Stored in tenancies.notices by kind. */
export type RecordKind =
  | "inspection" | "electronic_refund" // California's two notices (New York's inspection-rights notice reuses "inspection")
  | "move_in_inspection" | "deposit_account" | "holding_notice" | "move_in_checklist"
  | "forwarding_address" | "claim_notice" | "claim_objection"
  | "late_acknowledgment"; // New York: the landlord's recorded reason for keeping deductions after day 14 (N21)

export type RecordDef = {
  kind: RecordKind;
  slug: string; // the URL slug of its page: /tenancy/[id]/notices/[slug]
  phase: "move_in" | "notice" | "move_out";
  title: string; // the draft's title, or the record's name in full
  short: string; // a few words, lower case: "initial-inspection notice"
  cite: string;
  rule: string; // the spec's rule id
  tip: string; // the rule in one or two sentences, for its Why? tip
  draft: boolean; // a printable draft page exists
  menu?: string; // its entry in the property's overflow menu, e.g. "Inspection notice draft"
  methods: [NoticeMethod, string][]; // how it may be given (or received)
  toLabel: string; // "Given to", "From", "Signed with"; empty for a record with no addressee (where a deposit is held)
  verb: string; // "Given", "Signed", "Recorded", "Received", "Sent", "Offered", "Acknowledged"
  detail?: { label: string; required: boolean; placeholder?: string }; // a tracking number, an account, an address
  received?: boolean; // ask for the day the tenant received it (Florida's claim notice by certified mail)
  beforeInvoice?: boolean; // a move-in record that comes before the deposit invoice (Washington's checklist)
  after?: RecordKind; // shown only once this record exists (Florida: the objection after the claim notice)
  hiddenUntilRecorded?: boolean; // listed only once made; reached from the step or blocker that asks for it (New York's late acknowledgment)
  /** A line about the record as it stands, for its page's status card (Florida: whether an objection came in time). */
  status?: (notices: Notices) => { text: string; tone: "green" | "amber" | "red" } | null;
  form?: { method: string; date: string; button: string }; // the record form's labels when they aren't a notice's
  heading?: string; // the draft's statute line, e.g. "Florida Statutes section 83.49(3)(a)"
  draftBody?: (c: DraftContext) => DraftBlock[]; // the printable draft, for a state pack's own notices
  response?: string[]; // the tenant's response options under the draft
  when?: string; // when it is due, for the record page's status card
};

/** What a printable draft is filled from: the tenancy's own facts, with blanks where the file has none. */
export type DraftContext = {
  landlord: string; tenants: string; address: string; today: string;
  noticeGivenOn: string | null; endDate: string | null; ends: string | null;
  windowOpens: string | null; windowCloses: string | null; due: string | null;
  deposit: { amount: number; paypalId: string | null } | null;
  claim: { total: number; items: string[] } | null;
  multipleTenants: boolean;
};

/** One block of a draft. "[[blank]]" in a paragraph prints a line to fill in by hand. */
export type DraftBlock = { p: string } | { quote: string; caption: string } | { list: string[] };

/** One requirement a state adds to a tenancy's flow, as a next step or a blocker, with the rule behind it. */
export type StepHelpers = {
  dated: (label: string, detail: string, cite: string | null, due: string, deadline?: boolean, dueLabel?: string | null) => NextStep;
  undated: (label: string, detail: string, cite: string | null, level: NextStep["level"]) => NextStep;
};

export type StatementContext = {
  moveInPhotosRequired: boolean;
  documentsRequired: boolean;
  notices: Notices; // the state's records (a Florida claim notice, a Washington checklist, a Texas forwarding address)
  /** The notice to end the tenancy: the day, who gave it, and the end it named (New York's inspection-rights notice). */
  ending?: { givenOn: string | null; givenBy: "tenant" | "landlord" | null; ends: string | null };
};

export type StatePack = {
  code: StateCode;
  name: string; // "California"
  spec: string; // the rules spec in the repo, e.g. "docs/LEGAL_RULES.md"
  statute: {
    short: string; // "Civ. Code 1950.5", the chip: "Rules: Civ. Code 1950.5"
    full: string; // "California Civil Code 1950.5"
    inline: string; // the statute as a sentence names it: "Civil Code 1950.5"
    url: string;
    /** A ledger or statement tag as a full citation: California tags are subsections ("(h)(1)"). */
    tagCite: (tag: string) => string;
  };
  chip: Tip; // the property header's "Rules:" chip and its tip
  courtsGuide: { label: string; url: string }; // where disputes go, for the tenant page

  copy: {
    disclaimers: string[]; // LEGAL_RULES section F (or the state spec's K/L), word for word
    preparedUnder: string; // "Prepared with Good Faith ... under ..."
    noticeFooter: string; // the printed notices' footer line
    tenantAbout: string; // the tenant page's "About this page" tip
    wearRefused: string; // a wear-and-tear deduction refused by the route
    statementCite: string; // the statement's header citation: "California Civil Code 1950.5(h)"
    guidanceLabel: string; // how proration is labeled: "DRE guidance" or "Common practice"
    guidanceNote: string; // the tip on a prorated deduction
    guidanceCite: string; // the citation a prorated finding's tip appends
  };

  lease: {
    evaluate: (t: LeaseTerms) => Flag[];
    lawful: (t: LeaseTerms) => LawfulDeposit | null;
    securityTotal: (t: LeaseTerms) => number; // what the lease asks as security, by the state's definition
    securityCharge: (c: LeaseTerms["otherMoveInCharges"][number]) => boolean; // a move-in charge counted in securityTotal
    chargeWord: string; // what the lease check calls those charges: "fee" (California) or "charge"
    confirmState: boolean; // the lease check offers the state picker even when the lease names this state
    /** The lease check's facts strip: the cap fact's tip and its sub line. */
    capTip: Tip;
    capSub: (t: LeaseTerms, lawful: LawfulDeposit | null) => string;
    lawfulSub: (lawful: LawfulDeposit | null, over: number) => string;
    law: { label: string; line: string; fact: string; cite: string }[]; // the lease page's three cards
    steps: { title: string; text: string; cite: string }[]; // the lease page's four steps
    invoiceNote: (lawful: LawfulDeposit) => string; // the PayPal invoice's note
    invoiceTerms: string; // the PayPal invoice's terms and conditions
    capUnknown: string; // the invoice route's refusal when the cap can't be told
  };

  deadline: {
    days: number;
    clockStart: (c: ClockInput) => string | null;
    due: (c: ClockInput) => string | null;
    tip: Tip; // "21 days after move-out"
    summary: string; // the deadline in a few words, for a tip that speaks for several states: "21 days"
    railText: string; // the Properties rail's tip: the deadline and what missing it risks
    clockWord: string; // "the 21-day clock"
    lateWarning: (daysLate: number, due: string) => string; // the close-out's warning once the deadline passed
    /** The last day the statement and refund may lawfully go out, when the statute moves a due date that falls on a
     *  weekend or holiday (New York, General Construction Law 25-a); the due date itself otherwise. */
    lastDay?: (due: string) => string;
    /** The deadline's words where they turn on the track (Florida: a claim notice changes what is due). The default is
     *  "Statement and refund due", "Within the N days" and "N-day deadline". */
    words?: (c: ClockInput) => { due: string; within: string; title: string };
    moveOutFirst: string; // the close-out's blocker before the move-out date
    ledgerAllowed: number | null; // the ledger's "(21 allowed)"; null where the deadline turns on more than the move-out
  };

  moveOut: {
    photosTip: Tip; // the move-out photos card: before any cleaning or repair
  };

  moveIn: {
    photosFrom: string | null; // move-in photos required for tenancies from this date; null: not required by statute
    photosTip: Tip;
    photosDocTip: Tip; // the Documents tab's move-in photos row
    oldPhotosStep: { detail: string; cite: string }; // tenancy from before photosFrom, or no photo statute
    lawCheckTip: Tip; // the "Lease checked" step
    depositTip: Tip; // the "Deposit through PayPal" step
    capUnknownLine: string; // when the cap can't be told yet
  };

  refund: {
    agreementRequired: boolean; // PayPal only with the tenants' written agreement
    invoiceFirst: string; // the deposit-invoice route's refusal before the agreement or the PayPal account is recorded
    agreementTip: Tip;
    agreementText: string; // what the tenants sign
    agreementStep: { label: string; detail: string; cite: string };
    noAgreementBlocker: string;
    noDesignationBlocker: string; // a Payout with no account the tenants designated
    documentsTip: { title: string; text: string; cite: string }; // the Documents tab's refund agreement row
  };

  documents: {
    threshold: number | null; // repair and cleaning over this need their documents; 0: always; null: never by statute
    afterPhotoRequired: boolean;
    vendorContactRequired: boolean;
    evidenceRequired: boolean; // product policy: each repair or cleaning line carries some evidence (Texas)
    settlementTip: (required: boolean) => { cite: string; text: string; docs: string };
    refundCheck: (required: boolean, total: number) => string; // the refund page's "Deductions documented" value
    afterPhotoTip: Tip;
    estimateTip: Tip;
    noteTip: Tip; // "Why this work" on the deduction form
  };

  tags: Record<"rent" | "damage" | "cleaning", { tag: string; short: string; label: string }>;

  ledger: {
    capTag: (lawful: LawfulDeposit | null, rent: number | null) => { tag: string; tagShort: string; tagLabel: string };
    paymentTag: (electronic: boolean) => { tag: string; tagShort: string; tagLabel: string };
    refundTag: { tag: string; tagShort: string; tagLabel: string };
    balanceTag: { tag: string; tagShort: string; tagLabel: string; detail: string };
    typeTip: Tip; // the Payments table's "Each row's rule" tip
  };

  findings: Record<"damage" | "cleaning" | "wear_and_tear" | "unclear", { rule: string; note: string; cite: string }>;

  records: RecordDef[];

  notices: {
    /** Whether the electronic-refund notice is owed (California); null for a state without one. */
    refundNotice: boolean;
    inspection: {
      windowDays: number; // the inspection may happen no earlier than this many days before the end
      noticeHours: number;
      lateLimitDays: number | null; // and no later than this many days before the end (New York: 7)
      skipIfShortNotice: number | null; // not owed when the tenant gave less notice than this many days (New York: 14)
    } | null;
    sectionTip: Tip; // the "Notice and dates" card's tip
    inspectionNote: string; // the inspection row's tip on the tenancy page
    followTip: (windowOpens: string | null, due: string | null, passed: boolean) => string; // "What follows from the notice"
    followCite: string;
    datesTip: string; // "Four dates"
  };

  delivery: {
    tip: Tip;
    emailRule: "agreement" | "open" | "courtesy"; // email as the delivery of record: by written agreement, always, or never
    emailLabel: string; // the checkbox for the agreement
    emailWord: string; // email as the delivery record names it: "email, by written agreement", "email under s. 83.505"
    emailShort: string; // the same on the delivery card: "Email, by agreement"
    multipleTo: string; // the delivery form's hint with more than one adult tenant
    emailRefused: string;
    unitFallback: boolean; // mail to the vacated unit when no forwarding address was given
    noForwarding: string; // refused mail to the unit
    mailHint: (unit: string, forwarding: { name: string | null; date: string } | null) => string;
    addressedCite: string;
    toCite: string;
  };

  close: {
    rules: Record<string, string>; // the only citations the agent may use
    extraBlockers: (f: CloseOutFacts, ctx: CloseOutContext) => string[];
    extraWarnings: (f: CloseOutFacts, ctx: CloseOutContext) => string[];
    /** How the claimed amounts stand when they are not plainly deducted (Florida: claimed and disputed by a timely
     *  objection; New York: kept after day 14 under the landlord's acknowledgment). The statement, its PDF and the
     *  tenant page print it beside the deductions; null when they are plain deductions. */
    standing?: (c: StandingInput) => { label: string; note: string } | null;
  };

  steps: {
    flow: FlowCopy;
    /** The state's next open move-in step, if any: before the deposit invoice (a Washington checklist, a New York
     *  inspection offer) or after the payment (the account the deposit is held in); null when none is open. */
    moveIn: (t: TenancySummary, today: string, h: StepHelpers) => { step: NextStep; beforeInvoice: boolean } | null;
    /** The state's own step once notice is given, while the move-out is still ahead (Texas: the forwarding address in
     *  writing, asked for before the tenants leave); null when none is open. Absent in California. */
    beforeMoveOut?: (t: TenancySummary, today: string, h: StepHelpers) => NextStep | null;
    /** Extra steps after the comparison, before the statement and refund; null when none is open. */
    afterInspection: (t: TenancySummary, today: string, h: StepHelpers) => NextStep | null;
    /** Move-in items still open that the card lists under a later step. */
    openMoveIn: (t: TenancySummary) => string[];
  };

  calendar: {
    checkIn: (where: string, ends: string) => string;
    window: (ends: string) => string;
    moveOut: (lead: string) => string;
    due: { label: string; summary: (where: string) => string; description: (ends: string) => string };
  };

  statement: {
    checklist: (s: Statement, ctx: StatementContext) => ChecklistItem[];
    short: Record<number, string>; // the checklist items in a few words
    checklistTip: string;
    interest: (city: string | null, s: { buildingUnits: number | null; notices: Notices }) => Statement["interest"];
    interestTitle: string;
    wearAtZero: boolean; // the statement lists the wear-and-tear findings at $0 (the Texas, Florida and Washington specs)
    basisNote: (t: LeaseTerms, depositAmount: number, lawful: LawfulDeposit | null) => string | null;
    documentsNote: (required: boolean, repairAndCleaning: number, anyRepairs: boolean) => string;
    documentsLine: (required: boolean, repairAndCleaning: number) => string; // on screen
    documentsCite: (required: boolean) => string;
    refundNote: (r: RefundNoteInput) => string;
    refundDueMethod: (r: { electronic: boolean; paypalEmail: string | null }) => string;
    sections: { security: Tip; deductions: Tip; refund: string; delivery: Tip };
    documentRow: Tip; // the Documents tab's itemized statement row
    headerTip: Tip; // the statement page's header tip
    estimateNote: string; // on the statement, an estimate's line
    estimateLine: string; // the same on screen, without its citation
    dueTipText: string; // the statement's "Due by" tip
    guidanceSource: string; // where proration comes from: "from the DRE's California Tenants guide"
    estimateCite: string;
    pdf: { deadlineLine: string; dueSuffix: string };
  };

  tenant: {
    detailsTip: Tip;
    dueTip: Tip;
    paidLine: string; // "It comes back, less any lawful deductions, within 21 days after you move out."
    documentsTip: (required: boolean) => Tip;
    mailTip: (movedOut: boolean) => Tip;
    deliveryCite: string;
    prorationNote: string; // a prorated deduction's note: "Proration ... is published guidance, not statute."
    agreementTip: (o: { agreed: boolean; electronic: boolean }) => { title: string; text: string | null; cite: string };
    rights: (v: TenantView, moveInPhotosRequired: boolean) => { title: string; text: ReactNode; cite: string }[];
  };

  ai: {
    reasonExample: string | null; // the finding schema's example reason; null keeps California's (the DRE guide)
    inspectorRole: string; // "You inspect rental units at move-out for a California landlord's security deposit tool."
    inspectionGuide: string;
    closeOutSystem: string;
    factsToolDescription: string;
    checklistToolDescription: string;
  };

  /** Local rules the pack knows of, shown as a warning that local rules may add requirements, never enforced. */
  localOverlays: { city: string; match: RegExp; line: string }[];
};

/** The sections only server code reads (statement.ts, closeout.ts, agent.ts, inspect.ts, next-step.ts, ics.ts, the
 *  tenant page); they live in `<state>.server.ts`. */
export type ServerKeys = "ai" | "close" | "statement" | "tenant" | "calendar" | "steps";
/** What client components get from `packFor` in `src/lib/states/index.ts`. */
export type ClientPack = Omit<StatePack, ServerKeys>;
/** A pack's server half, joined to its ClientPack by `src/lib/states/server.ts`. */
export type ServerPart = Pick<StatePack, ServerKeys>;

/** What a claim's standing is read from; the close-out and the tenant page both have it. */
export type StandingInput = { today: string; notices: Notices; claimed: number; statementDue: string | null };

export type CloseOutContext = {
  today: string;
  notices: Notices;
  forwarding: { address: string; date: string } | null;
  endDate: string | null;
  plannedMoveOut: string | null;
  deductionsCount: number;
};

export type RefundNoteInput = {
  tenants: string[];
  paid: boolean;
  electronic: boolean;
  signed: string | null; // "the written agreement signed by ... on ..."
  paidBy: string;
};

/** The words of the next-step machinery that name the law. California's are the app's original sentences. */
export type FlowCopy = {
  doneCite: string;
  sendRefundCite: string;
  photosOut: { detail: string; cite: string };
  compareCite: string;
  deliveryCite: string;
  statementDetail: (moveOut: string) => string;
  statementCite: string;
  tenantNoticeCite: string;
  noDateDetail: string;
  windowStep: (windowOpens: string) => string;
  /** The inspection-notice step's detail, where the state has the notice; and whether the step links to its page. */
  inspectionStep?: (noticeGivenOn: string, windowOpens: string | null) => string;
  inspectionAction?: boolean;
  windowCite: string;
  moveOutStep: (ends: string) => string;
  moveOutCite: string;
  invoice: { detail: string; cite: string };
  unpaidCite: string;
  photosIn: { detail: string; cite: string };
  leaseEndsCite: string;
};

export type { NoticeGiven };
