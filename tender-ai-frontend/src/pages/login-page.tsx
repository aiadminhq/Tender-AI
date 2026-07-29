// 登入閘門：未登入時取代整個 App。信箱＋密碼通過後端驗證即進入；
// 後端不可達時提供「改用示範模式」退化入口，維持離線可用。
import { useState, type FormEvent } from "react";
import { Check, KeyRound } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ErrState = null | "credentials" | "network" | "oauth";

export function LoginPage() {
  const { t, lang, toggleLang } = useApp();
  const { login, loginWithGoogle, enterMock } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<ErrState>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [shareLayerB, setShareLayerB] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !acceptedAgreement) return;
    setErr(null);
    setBusy(true);
    try {
      const ok = await login(email.trim(), password, shareLayerB);
      if (!ok) setErr("credentials"); // 成功時 status 轉 authed，App 會切換畫面
    } catch {
      setErr("network"); // LoginError("network")：後端不可達
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignIn() {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch {
      setErr("oauth");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={40} />
          <h1 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">
            {t("loginTitle")}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t("loginSub")}</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-border bg-card p-5"
        >
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
              {t("loginEmail")}
            </span>
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder={t("loginEmailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
              {t("loginPassword")}
            </span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <label className="mb-2 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
            <input
              type="checkbox"
              checked={acceptedAgreement}
              onChange={(event) => setAcceptedAgreement(event.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
            />
            <span>{t("loginAgreement")}</span>
          </label>
          <label className="mb-4 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
            <input
              type="checkbox"
              checked={shareLayerB}
              onChange={(event) => setShareLayerB(event.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
            />
            <span>{t("loginShareConsent")}</span>
          </label>

          {err === "credentials" && (
            <p
              role="alert"
              className="mb-3 text-[12px] font-medium text-destructive"
            >
              {t("loginErrCredentials")}
            </p>
          )}

          {err === "oauth" && (
            <p
              role="alert"
              className="mb-3 text-[12px] font-medium text-destructive"
            >
              {t("loginOAuthError")}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || !acceptedAgreement}
          >
            {busy ? t("loginSubmitting") : t("loginSubmit")}
          </Button>

          {isSupabaseAuthConfigured() && (
            <Button
              type="button"
              variant="outline"
              className="mt-2.5 w-full"
              disabled={busy}
              onClick={() => void onGoogleSignIn()}
            >
              <KeyRound size={15} />
              {t("loginGoogle")}
            </Button>
          )}

          {err === "network" && (
            <div className="mt-4 rounded-md border border-border bg-surface-1 p-3">
              <p className="text-[12px] font-medium text-ink">
                {t("loginErrNetwork")}
              </p>
              {import.meta.env.DEV && (
                <>
                  <p className="mt-1 text-[11px] text-ink-dim">
                    {t("loginMockHint")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2.5 w-full"
                    onClick={enterMock}
                  >
                    {t("loginUseMock")}
                  </Button>
                </>
              )}
            </div>
          )}
        </form>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-dim">
          <Check size={12} className="text-emerald-600" />
          {t("loginAccessScope")}
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={toggleLang}
            className="text-[11px] text-ink-dim transition-colors hover:text-ink-muted"
          >
            {lang === "zh" ? "English" : "繁體中文"}
          </button>
        </div>
      </div>
    </div>
  );
}
