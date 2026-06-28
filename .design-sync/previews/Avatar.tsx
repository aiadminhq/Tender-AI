import { Avatar } from "tender-ai-frontend";

// Tender AI 用 Avatar 具名標示 Layer B 的貢獻者（白名單同事）。
// 取 user 的 initials / color / name；支援 sm / md / lg 三尺寸與 ring。

const aaron = { initials: "AC", color: "#2563eb", name: "Aaron Chang" };
const mei = { initials: "ML", color: "#0d9488", name: "Mei Lin" };
const jun = { initials: "JW", color: "#db2777", name: "Jun Wu" };

export const Sizes = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <Avatar user={aaron} size="sm" />
    <Avatar user={aaron} size="md" />
    <Avatar user={aaron} size="lg" />
  </div>
);

export const Contributors = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Avatar user={aaron} size="md" />
      <span style={{ fontSize: 13 }}>Aaron Chang ・ 收藏並評為可行</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Avatar user={mei} size="md" />
      <span style={{ fontSize: 13 }}>Mei Lin ・ 新增承接原因</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Avatar user={jun} size="md" />
      <span style={{ fontSize: 13 }}>Jun Wu ・ 標記為不可行</span>
    </div>
  </div>
);

export const Stack = () => (
  <div style={{ display: "flex", alignItems: "center", paddingLeft: 4 }}>
    <span style={{ marginLeft: -4 }}>
      <Avatar user={aaron} size="md" ring />
    </span>
    <span style={{ marginLeft: -4 }}>
      <Avatar user={mei} size="md" ring />
    </span>
    <span style={{ marginLeft: -4 }}>
      <Avatar user={jun} size="md" ring />
    </span>
  </div>
);
