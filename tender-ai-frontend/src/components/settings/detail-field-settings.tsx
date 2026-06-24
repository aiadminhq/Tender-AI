// 設定 · 標案詳情欄位顯示：勾選哪些「常態性規格表」欄位要在詳情頁出現（GET/PUT /settings/detail-fields）。
// 這是團隊共用設定（單列、跨人共享），讓不需要的欄位整列隱藏（原版 PCC 頁面欄位太多）。
// 只存 UI 偏好（被隱藏的欄位鍵），不含 Layer A/B 內容；卡片自身文案用雙語 inline（不動 strings.ts），
// 欄位標籤重用既有 i18n key（與詳情規格表同一份 DETAIL_FIELDS）。
import { useEffect, useState } from "react";
import { useApp } from "@/store/app-context";
import {
  DETAIL_FIELDS,
  saveHiddenDetailFields,
  useHiddenDetailFields,
} from "@/lib/detail-fields";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

// 卡片自身 chrome 文案（雙語 inline；欄位名稱另走 t(f.labelKey)）。
const CHROME = {
  zh: {
    hint: "勾選要在標案詳情頁顯示的欄位；關閉的欄位整列隱藏。此為團隊共用設定，會同步給白名單內所有同事。",
    visible: "顯示",
    save: "儲存",
    saving: "儲存中…",
    saved: "已儲存",
    error: "儲存失敗，請稍後再試。",
  },
  en: {
    hint: "Pick which fields appear on a tender's detail page; fields you turn off are hidden entirely. This is a team-shared setting and syncs to everyone on the whitelist.",
    visible: "Visible",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed. Please try again.",
  },
} as const;

export function DetailFieldSettings() {
  const { lang, t } = useApp();
  const hidden = useHiddenDetailFields();
  const c = lang === "en" ? CHROME.en : CHROME.zh;

  // 受控草稿：就地切換，按「儲存」才送 PUT（與 BrainPicker 同節奏）。
  const [draft, setDraft] = useState<Set<string>>(() => new Set(hidden));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);

  // 共享 store 載入後（惰性 fetch）回填草稿；使用者已動過則不覆蓋其編輯。
  useEffect(() => {
    if (!dirty) setDraft(new Set(hidden));
  }, [hidden, dirty]);

  function toggle(key: string, visible: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
    setSaved(false);
    setErr(false);
  }

  async function onSave() {
    if (busy) return;
    setBusy(true);
    setErr(false);
    setSaved(false);
    try {
      await saveHiddenDetailFields([...draft]);
      setDirty(false);
      setSaved(true);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <p className="text-[12px] leading-relaxed text-ink-muted">{c.hint}</p>

      <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline">
        {DETAIL_FIELDS.map((f) => {
          const visible = !draft.has(f.key);
          return (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <span className="min-w-0 truncate text-[13px] text-ink">
                {t(f.labelKey)}
              </span>
              <Switch
                checked={visible}
                onCheckedChange={(v) => toggle(f.key, v)}
                disabled={busy}
                label={`${c.visible} · ${t(f.labelKey)}`}
              />
            </li>
          );
        })}
      </ul>

      {err && (
        <p role="alert" className="text-[12px] font-medium text-destructive">
          {c.error}
        </p>
      )}
      {saved && (
        <p className="text-[12px] font-medium text-success">{c.saved}</p>
      )}

      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onSave}
        disabled={busy || !dirty}
      >
        {busy ? c.saving : c.save}
      </Button>
    </div>
  );
}
