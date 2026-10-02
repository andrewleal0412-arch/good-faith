"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
      Print
    </button>
  );
}
