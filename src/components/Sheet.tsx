"use client";

import { useEffect } from "react";

type SheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/** Bottom sheet — the app's only modal pattern. */
export default function Sheet({ open, title, onClose, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative mx-auto w-full max-w-md rounded-t-3xl bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm font-medium text-muted transition active:bg-border"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
