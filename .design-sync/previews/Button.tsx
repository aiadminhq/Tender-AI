import { Button } from "tender-ai-frontend";

// Tender AI 的行動按鈕家族：主行動 primary（圓角 12px / rounded-xl），
// 其餘為「抬升非變色」的中性表面。一格一故事，內容用真實標案操作語境。

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, maxWidth: 460 }}>
    <Button variant="primary">確認承接</Button>
    <Button variant="secondary">查看詳情</Button>
    <Button variant="outline">加入收藏</Button>
    <Button variant="ghost">略過</Button>
    <Button variant="destructive">標記不可行</Button>
  </div>
);

export const Sizes = () => (
  <div
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}
  >
    <Button variant="primary" size="sm">
      小
    </Button>
    <Button variant="primary" size="md">
      中（預設）
    </Button>
    <Button variant="primary" size="lg">
      大
    </Button>
  </div>
);

export const States = () => (
  <div
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}
  >
    <Button variant="primary">可點擊</Button>
    <Button variant="primary" disabled>
      停用
    </Button>
    <Button variant="secondary" disabled>
      停用
    </Button>
  </div>
);
