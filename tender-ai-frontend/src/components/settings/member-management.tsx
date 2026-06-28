// 設定 · 成員管理（白名單）。Issue #1 指派名單的事實來源。
// 治理紅線：① 新成員 whitelistActive 預設 OFF（須管理員開通）；② email 限 @hqdesign.tw；
// ③ consentShared（本人是否同意行為共享）唯讀顯示，不可由管理員代切。
// 前端優先：本地 members 先改；live+admin 再 best-effort 呼 setWhitelist 落地伺服器。
import { useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { useAppData } from "@/store/app-data";
import { setWhitelist } from "@/lib/auth-api";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const HQ_EMAIL_RE = /^[^@\s]+@hqdesign\.tw$/;

export function MemberManagement() {
  const { t } = useApp();
  const { isAdmin, isMock } = useAuth();
  const { members, addMember, toggleMemberWhitelist, removeMember } =
    useAppData();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  function submit() {
    const nm = name.trim();
    const em = email.trim().toLowerCase();
    if (!nm) return;
    if (!HQ_EMAIL_RE.test(em)) {
      setErr(t("emailDomainErr"));
      return;
    }
    if (members.some((m) => m.email?.toLowerCase() === em)) {
      setErr(t("emailDomainErr"));
      return;
    }
    addMember({ name: nm, email: em, role });
    setName("");
    setEmail("");
    setRole("member");
    setErr(null);
    setAdded(nm);
  }

  function onToggleWhitelist(id: number, email: string | null, next: boolean) {
    toggleMemberWhitelist(id);
    // live+admin：best-effort 落地伺服器（失敗不回滾本地，前端優先）。
    if (!isMock && isAdmin && email) void setWhitelist(email, next);
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-ink-muted">
        {t("memberManageHint")}
      </p>

      <ul className="divide-y divide-border">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar user={m} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {m.name}
              </p>
              <p className="truncate text-[11px] text-ink-dim">
                {m.email ?? "—"}
                {m.role ? ` · ${m.role}` : ""}
              </p>
            </div>
            <Badge variant={m.consentShared ? "success" : "muted"}>
              {m.consentShared ? t("consentShared") : t("consentNotShared")}
            </Badge>
            {isAdmin ? (
              <Switch
                checked={m.whitelistActive}
                onCheckedChange={(v) => onToggleWhitelist(m.id, m.email, v)}
                label={t("whitelistToggle")}
              />
            ) : (
              <Badge variant={m.whitelistActive ? "signal" : "muted"}>
                {t("whitelistToggle")}
              </Badge>
            )}
            {isAdmin && (
              <button
                type="button"
                aria-label={t("memberRemove")}
                onClick={() => removeMember(m.id)}
                className="shrink-0 rounded p-1 text-ink-dim transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="rounded-md border border-border bg-surface-1 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
            <UserPlus size={13} /> {t("addMember")}
          </div>
          {added && (
            <p className="mt-2 text-[12px] font-medium text-success">
              {t("memberAdded").replace("{name}", added)}
            </p>
          )}
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setAdded(null);
              }}
              placeholder={t("memberName")}
              aria-label={t("memberName")}
            />
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr(null);
                setAdded(null);
              }}
              placeholder={t("memberEmail")}
              aria-label={t("memberEmail")}
            />
            <Select
              value={role}
              onValueChange={setRole}
              options={[
                { value: "member", label: t("adminRoleMember") },
                { value: "admin", label: t("adminRoleAdmin") },
              ]}
              aria-label={t("memberRole")}
            />
          </div>
          {err && (
            <p
              role="alert"
              className="mt-2 text-[12px] font-medium text-destructive"
            >
              {err}
            </p>
          )}
          <div className="mt-2.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!name.trim() || !email.trim()}
            >
              {t("addMember")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
