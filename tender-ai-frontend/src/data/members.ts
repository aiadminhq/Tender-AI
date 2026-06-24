// 白名單成員種子（前端優先：tender:members 的初始內容）。
// 形狀對齊後端 users 表；email 為 @hqdesign.tw（合作範圍）。live+admin 時由
// fetchAccounts() 依 email 併入真實 id / whitelist / consent，覆寫此處種子。
//
// 治理：此種子代表「已上線的團隊」，故多數 whitelistActive:true 以便看板開箱即用；
// 由 UI 新增的成員一律預設 whitelistActive:false（管理員另行開通），見 app-data.addMember。
// 第二段同意（consentShared）此處僅作展示，前端不切換、只讀（本人於後端授權）。
import type { Member } from "@/types/domain";
import { authDisplay } from "@/lib/auth-api";

interface SeedInput {
  id: number;
  name: string;
  email: string;
  role: string;
  whitelistActive: boolean;
  consentShared: boolean;
}

// id 用小正整數（對齊後端 users.id 的形狀）；live+admin hydration 會以真實 id 覆寫。
const RAW: SeedInput[] = [
  {
    id: 1,
    name: "Alex Chen",
    email: "alex@hqdesign.tw",
    role: "admin",
    whitelistActive: true,
    consentShared: true,
  },
  {
    id: 2,
    name: "David Wu",
    email: "david@hqdesign.tw",
    role: "member",
    whitelistActive: true,
    consentShared: true,
  },
  {
    id: 3,
    name: "Aaron Lin",
    email: "aaron@hqdesign.tw",
    role: "member",
    whitelistActive: true,
    consentShared: true,
  },
  {
    // 已開通白名單、但本人尚未同意行為共享（展示兩段式同意的差異）。
    id: 4,
    name: "Jamie Tsai",
    email: "jamie@hqdesign.tw",
    role: "member",
    whitelistActive: true,
    consentShared: false,
  },
  {
    // 尚未開通白名單 → 不會出現在指派選單（展示 Issue #1 的名單過濾）。
    id: 5,
    name: "Yvonne Chang",
    email: "yvonne@hqdesign.tw",
    role: "member",
    whitelistActive: false,
    consentShared: false,
  },
];

export const SEED_MEMBERS: Member[] = RAW.map((m) => {
  const d = authDisplay({ name: m.name, email: m.email });
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    whitelistActive: m.whitelistActive,
    consentShared: m.consentShared,
    initials: d.initials,
    color: d.color,
  };
});
