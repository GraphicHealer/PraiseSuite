import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type DialogState =
  | { kind: "prompt"; message: string; def: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; resolve: (v: boolean) => void };

interface DialogApi {
  /** window.prompt() replacement — Electron has no native prompt. */
  prompt(message: string, def?: string): Promise<string | null>;
  confirm(message: string): Promise<boolean>;
}

const DialogCtx = createContext<DialogApi>({
  prompt: () => Promise.resolve(null),
  confirm: () => Promise.resolve(false),
});

export const useDialog = (): DialogApi => useContext(DialogCtx);

const btn =
  "rounded border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
const primary =
  "rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-500";

/**
 * App modal system: promise-based prompt()/confirm() replacements that work
 * in Electron (which lacks native dialogs). Real focus trap, aria labeling,
 * and focus restoration to the invoking element on close.
 */
export function DialogProvider({ children }: { children: ReactNode }): ReactNode {
  const [dlg, setDlg] = useState<DialogState | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const prompt = useCallback(
    (message: string, def = "") =>
      new Promise<string | null>((resolve) => {
        restoreRef.current = document.activeElement;
        setValue(def);
        setDlg({ kind: "prompt", message, def, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        restoreRef.current = document.activeElement;
        setDlg({ kind: "confirm", message, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (dlg?.kind === "prompt") inputRef.current?.select();
  }, [dlg]);

  const close = (result: string | boolean | null) => {
    if (!dlg) return;
    if (dlg.kind === "prompt") dlg.resolve(typeof result === "string" ? result : null);
    else dlg.resolve(result === true);
    setDlg(null);
    // Return focus to the element that opened the dialog.
    if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    restoreRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close(null);
      e.stopPropagation();
      return;
    }
    if (e.key === "Enter" && dlg?.kind === "confirm") {
      // A focused button handles Enter itself (click) — don't double-fire.
      if (!(e.target instanceof HTMLButtonElement)) close(true);
      e.stopPropagation();
      return;
    }
    if (e.key === "Tab" && panelRef.current !== null) {
      // Focus trap: keep Tab/Shift-Tab cycling inside the dialog.
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        "input, button, [tabindex]",
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      } else if (!panelRef.current.contains(document.activeElement)) {
        first.focus();
        e.preventDefault();
      }
    }
    e.stopPropagation();
  };

  return (
    <DialogCtx.Provider value={{ prompt, confirm }}>
      {children}
      {dlg !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={onKeyDown}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-message"
            className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <p id="app-dialog-message" className="mb-3 text-sm">{dlg.message}</p>
            {dlg.kind === "prompt" && (
              <input
                ref={inputRef}
                autoFocus
                aria-label={dlg.message}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") close(value);
                }}
                className="mb-3 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => close(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={primary}
                autoFocus={dlg.kind === "confirm"}
                onClick={() => close(dlg.kind === "prompt" ? value : true)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogCtx.Provider>
  );
}
