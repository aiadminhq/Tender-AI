import { TierBadge } from "tender-ai-frontend";

// 可行度分級徽章（high / mid / low），帶語意色點。文案走 i18n（lang="zh" 為預設）。
// Tender AI 用它在標案卡上一眼標示 AI 大腦的承接優先級。

export const Tiers = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
    <TierBadge tier="high" lang="zh" />
    <TierBadge tier="mid" lang="zh" />
    <TierBadge tier="low" lang="zh" />
  </div>
);

export const InContext = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TierBadge tier="high" lang="zh" />
      <span style={{ fontSize: 13, opacity: 0.75 }}>校舍耐震補強統包工程</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TierBadge tier="mid" lang="zh" />
      <span style={{ fontSize: 13, opacity: 0.75 }}>市立圖書館空調汰換</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TierBadge tier="low" lang="zh" />
      <span style={{ fontSize: 13, opacity: 0.75 }}>偏遠道路路面整修</span>
    </div>
  </div>
);

export const English = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
    <TierBadge tier="high" lang="en" />
    <TierBadge tier="mid" lang="en" />
    <TierBadge tier="low" lang="en" />
  </div>
);
