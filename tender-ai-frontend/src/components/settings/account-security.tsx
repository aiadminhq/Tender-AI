// 設定 · 帳號安全：本人改密表單（PUT /me/password，須帶舊密碼）。
// 成功後以後端回傳的最新身分 refreshUser（清除 passwordIsDefault）。
// 示範模式（id=0）不提供改密。
import { useState, type FormEvent } from "react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { changePassword, type PasswordResult } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ErrKey = Exclude<PasswordResult, { ok: true }>["kind"] | "mismatch";

const ERR_STRING: Record<
  ErrKey,
  "pwErrWrongOld" | "pwErrTooShort" | "pwErrMismatch" | "pwErrNetwork"
> = {
  wrong_old: "pwErrWrongOld",
  too_short: "pwErrTooShort",
  not_found: "pwErrNetwork",
  network: "pwErrNetwork",
  mismatch: "pwErrMismatch",
};

export function AccountSecurity() {
  const { t } = useApp();
  const { user, isMock, refreshUser } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState<ErrKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user || isMock) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !user) return;
    setErr(null);
    setDone(false);
    if (newPw !== confirmPw) {
      setErr("mismatch");
      return;
    }
    setBusy(true);
    const res = await changePassword(oldPw, newPw);
    setBusy(false);
    if (res.ok) {
      refreshUser(res.user);
      setDone(true);
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
    } else {
      setErr(res.kind);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {t("pwCurrent")}
        </span>
        <Input
          type="password"
          autoComplete="current-password"
          value={oldPw}
          onChange={(e) => {
            setOldPw(e.target.value);
            setErr(null);
            setDone(false);
          }}
          disabled={busy}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {t("pwNew")}
        </span>
        <Input
          type="password"
          autoComplete="new-password"
          value={newPw}
          onChange={(e) => {
            setNewPw(e.target.value);
            setErr(null);
            setDone(false);
          }}
          disabled={busy}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {t("pwConfirm")}
        </span>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPw}
          onChange={(e) => {
            setConfirmPw(e.target.value);
            setErr(null);
            setDone(false);
          }}
          disabled={busy}
          required
        />
      </label>

      {err && (
        <p role="alert" className="text-[12px] font-medium text-destructive">
          {t(ERR_STRING[err])}
        </p>
      )}
      {done && (
        <p className="text-[12px] font-medium text-success">{t("pwChanged")}</p>
      )}

      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        {busy ? t("pwChanging") : t("pwChange")}
      </Button>
    </form>
  );
}
