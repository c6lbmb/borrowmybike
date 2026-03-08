import React, { useEffect, useMemo, useState } from "react";

export type ChecklistItem = {
  id: string;
  /** Back-compat: older call sites used `label` as JSX. Newer ones may use `text` as string. */
  label?: React.ReactNode;
  text?: string;
};

type Props = {
  open: boolean;
  title: string;

  /** Optional intro block shown above checklist */
  intro?: React.ReactNode;

  requiredItems: ChecklistItem[];

  /** Optional footer block shown under checklist */
  footerNote?: React.ReactNode;

  confirmText?: string;
  cancelText?: string;

  onCancel: () => void;
  onConfirm: () => void;
};

export default function ChecklistGateModal(props: Props) {
  const {
    open,
    title,
    intro,
    requiredItems,
    footerNote,
    confirmText = "I understand",
    cancelText = "Cancel",
    onCancel,
    onConfirm,
  } = props;

  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, boolean> = {};
    for (const item of requiredItems) init[item.id] = false;
    setChecked(init);
  }, [open, requiredItems]);

  const allChecked = useMemo(() => {
    if (!requiredItems.length) return true;
    return requiredItems.every((i) => checked[i.id]);
  }, [checked, requiredItems]);

  const checkedCount = useMemo(() => {
    return requiredItems.filter((i) => checked[i.id]).length;
  }, [checked, requiredItems]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <div className="mt-1 text-sm font-medium text-slate-500">
            Check each item before continuing.
          </div>
        </div>

        {intro ? (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {intro}
          </div>
        ) : null}

        {!!requiredItems.length ? (
          <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            <div className="font-semibold text-slate-700">Checklist progress</div>
            <div className="font-extrabold text-slate-900">
              {checkedCount}/{requiredItems.length}
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {requiredItems.map((item) => {
            const labelNode = item.label ?? item.text ?? "";
            return (
              <label
                key={item.id}
                className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={!!checked[item.id]}
                  onChange={(e) =>
                    setChecked((prev) => ({
                      ...prev,
                      [item.id]: e.target.checked,
                    }))
                  }
                />
                <div className="text-sm leading-6 text-slate-800">{labelNode}</div>
              </label>
            );
          })}
        </div>

        {footerNote ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-slate-700">
            {footerNote}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={onCancel}
            type="button"
          >
            {cancelText}
          </button>
          <button
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={onConfirm}
            disabled={!allChecked}
            type="button"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}