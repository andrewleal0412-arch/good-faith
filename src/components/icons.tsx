// The app's line icons: 16px grid, 1.5 stroke, currentColor, so an icon takes the color of the text beside it.
// Drawn for this app (the mockup set), not a library, so every icon shares one weight and corner.

import type { SVGProps } from "react";

const P: Record<string, React.ReactNode> = {
  building: <path d="M2.5 13.5h11M3.5 13.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10M9.5 6.5h2a1 1 0 0 1 1 1v6M5.5 5h2M5.5 7.5h2M5.5 10h2" />,
  card: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2 6.5h12M4.5 10h2.5" /></>,
  doc: <><path d="M4 2.5h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" /><path d="M9 2.5v3h3M5.5 8.5h5M5.5 11h5" /></>,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  bell: <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11zM6.5 14h3" />,
  help: <><circle cx="8" cy="8" r="6" /><path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.6-.8 1.1M8 11.3h.01" /></>,
  "chev-down": <path d="m4 6 4 4 4-4" />,
  "chev-up": <path d="m4 10 4-4 4 4" />,
  "chev-right": <path d="m6 4 4 4-4 4" />,
  "chev-left": <path d="m10 4-4 4 4 4" />,
  updown: <path d="m5 6.5 3-3 3 3M5 9.5l3 3 3-3" />,
  "arrow-left": <path d="M13 8H3M7 4 3 8l4 4" />,
  "arrow-down": <path d="M8 3v10M4 9l4 4 4-4" />,
  "arrow-up-right": <path d="M5 11 11 5M6 5h5v5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  info: <><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.8M8 5.2h.01" /></>,
  download: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
  upload: <path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10" />,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>,
  camera: <><path d="M2.5 5.5h2.2l1-1.5h4.6l1 1.5h2.2v7h-11z" /><circle cx="8" cy="9" r="2" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></>,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  send: <path d="M14 2 2 7l5 2 2 5 5-12zM7 9l7-7" />,
  receive: <path d="M8 2.5v7M5 6.5l3 3 3-3M3 11v2a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2" />,
  mail: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4 5.5-4" /></>,
  users: <><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13c0-2.3 1.9-3.7 4.2-3.7s4.2 1.4 4.2 3.7M10.5 3.3a2.3 2.3 0 0 1 0 4.4M12 9.6c1.4.5 2.3 1.7 2.3 3.4" /></>,
  image: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="m13.5 10.5-3-3-5 5" /></>,
  "file-check": <><path d="M4 2.5h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" /><path d="M9 2.5v3h3M5.8 10l1.5 1.5L10.5 8" /></>,
  key: <><circle cx="5.5" cy="10.5" r="3" /><path d="m7.6 8.4 5.9-5.9M11 5l2 2M9 7l2 2" /></>,
  split: <path d="M3 13h10M4.5 10V3.5M8 10V5.5M11.5 10V7.5" />,
  columns: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M6.2 3v10M9.8 3v10" /></>,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  link: <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />,
  pen: <path d="M10.5 3.5l2 2L6 12l-2.5.5L4 10l6.5-6.5z" />,
  clock: <><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" /></>,
  printer: <><path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2" /><path d="M4.5 9.5h7v4h-7z" /></>,
  alert: <><path d="M8 2.5 14 13H2L8 2.5z" /><path d="M8 6.5v3M8 11.2h.01" /></>,
  "sign-out": <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11l3-3-3-3M13.5 8h-7" />,
  restart: <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8M2.8 2.5v2.4h2.4" />,
};

export type IconName = keyof typeof P;

export function Icon({ name, className, ...rest }: { name: IconName } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className={`block shrink-0 ${className ?? "size-4"}`} {...rest}>
      {P[name]}
    </svg>
  );
}

/** The three-dot overflow glyph, filled rather than stroked. */
export function MoreGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={`block shrink-0 ${className ?? "size-4"}`}>
      <circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" />
    </svg>
  );
}

/** PayPal's two-tone monogram, shown next to the word PayPal: the only non-brand color besides status. */
export function PayPalMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="PayPal" className="block shrink-0">
      <path fill="#003087" d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106z" />
      <path fill="#009CDE" d="M21.222 6.917a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
    </svg>
  );
}
