// 設定 · 成員密碼管理（管理員）：列出白名單帳號，逐一重置登入密碼。
// 列表 GET /admin/whitelist、重置 POST /admin/users/{id}/password，皆暫以
// X-User-Role: admin header 把關（信任邊界沿用 Phase 1，待伺服器端 session 強制）。
import { useEffect, useState } from "react";
import { useApp } from "@/store/app-context";
import {
  adminSetPassword,
  fetchAccounts,
  type AccountRow,
} from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminUserPasswords() {
  const { t } = useApp();
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAccounts().then((data) => {
      if (!alive) return;
      setRows(data);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  function startEdit(id: number) {
    setEditing(id);
    setPw("");
    setErr(null);
    setDoneFor(null);
  }

  async function confirmReset(row: AccountRow) {
    if (busy) return;
    setErr(null);
    setBusy(true);
    const res = await adminSetPassword(row.id, pw);
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      setPw("");
      setDoneFor(row.name);
    } else {
      setErr(res.kind === "too_short" ? t("pwErrTooShort") : t("pwErrNetwork"));
    }
  }

  if (loaded && !rows) {
    return <p className="text-[12px] text-ink-muted">{t("adminListError")}</p>;
  }
  if (!rows) {
    return <p className="text-[12px] text-ink-dim">{t("loading")}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-[12px] text-ink-muted">{t("adminListEmpty")}</p>;
  }

  return (
    <div className="space-y-1">
      {doneFor && (
        <p className="mb-2 text-[12px] font-medium text-success">
          {t("adminResetDone").replace("{name}", doneFor)}
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  {row.name}
                </p>
                <p className="truncate text-[11px] text-ink-dim">
                  {row.email ?? "—"} ·{" "}
                  {row.isAdmin ? t("adminRoleAdmin") : t("adminRoleMember")}
                </p>
              </div>
              {editing !== row.id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(row.id)}
                >
                  {t("adminResetPwShort")}
                </Button>
              )}
            </div>

            {editing === row.id && (
              <div className="mt-2.5 rounded-md border border-border bg-surface-1 p-3">
                <p className="mb-2 text-[12px] text-ink-muted">
                  {t("adminResetFor").replace("{name}", row.name)}
                </p>
                <Input
                  type="text"
                  autoComplete="off"
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setErr(null);
                  }}
                  disabled={busy}
                  placeholder={t("pwNew")}
                />
                {err && (
                  <p
                    role="alert"
                    className="mt-2 text-[12px] font-medium text-destructive"
                  >
                    {err}
                  </p>
                )}
                <div className="mt-2.5 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => confirmReset(row)}
                    disabled={busy || pw.length === 0}
                  >
                    {busy ? t("pwChanging") : t("adminResetConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    {t("adminResetCancel")}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
