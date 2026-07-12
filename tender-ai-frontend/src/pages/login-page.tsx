import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/store/auth-context";

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await login(email, password);
    setSubmitting(false);
    if (err) setError(err);
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle className="text-[15px]">投標作戰台登入</CardTitle>
          <p className="text-[12px] text-ink-dim">
            僅限白名單公司信箱（@hqdesign.tw）
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-dim">公司信箱</span>
              <Input
                type="email"
                autoComplete="username"
                placeholder="you@hqdesign.tw"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-dim">密碼</span>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-[12px] text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="mt-1">
              {submitting ? "登入中…" : "登入"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
