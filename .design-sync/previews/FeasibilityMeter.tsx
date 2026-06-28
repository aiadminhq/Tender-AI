import { FeasibilityMeter } from "tender-ai-frontend";

// 4px 可行度漸層條（綠→藍，設計系統少數允許的漸層用途）。value 0–100，
// showLabel 顯示右側數字。Tender AI 用它把 AI 大腦算出的可行度視覺化。

export const Levels = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 320 }}
  >
    <FeasibilityMeter value={88} showLabel />
    <FeasibilityMeter value={62} showLabel />
    <FeasibilityMeter value={34} showLabel />
    <FeasibilityMeter value={12} showLabel />
  </div>
);

export const InCard = () => (
  <div style={{ maxWidth: 340 }}>
    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
      校舍耐震補強統包工程
    </div>
    <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
      AI 大腦評估可行度
    </div>
    <FeasibilityMeter value={88} showLabel />
  </div>
);

export const NoLabel = () => (
  <div style={{ maxWidth: 240 }}>
    <FeasibilityMeter value={72} />
  </div>
);
