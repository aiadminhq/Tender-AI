import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Separator,
  FeasibilityMeter,
} from "tender-ai-frontend";

// Card 是 Tender AI 標案列表/詳情的基本容器。下列各格示範由 CardHeader /
// CardTitle / CardDescription / CardContent 組成的真實標案卡片（繁中為預設）。

export const TenderCard = () => (
  <Card style={{ maxWidth: 420 }}>
    {/* CardHeader 預設為左右橫向佈局；標案卡需直向堆疊，沿用 app 慣用法
        覆寫成 flex-col items-start（見 charts-page.tsx）。 */}
    <CardHeader className="flex-col items-start gap-1.5">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge variant="signal">⭐ 精選案件</Badge>
        <Badge variant="default">營繕工程</Badge>
      </div>
      <CardTitle>臺北市立大同國小校舍耐震補強統包工程</CardTitle>
      <CardDescription>臺北市政府教育局 ・ 公開招標</CardDescription>
    </CardHeader>
    <CardContent>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          fontSize: 13,
        }}
      >
        <div>
          <div style={{ opacity: 0.6 }}>預算金額</div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
            }}
          >
            NT$ 28,500,000
          </div>
        </div>
        <div>
          <div style={{ opacity: 0.6 }}>截止收件</div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
            }}
          >
            2026/07/18
          </div>
        </div>
      </div>
      <Separator className="my-3" />
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        可行度 88
      </div>
      <FeasibilityMeter value={88} />
    </CardContent>
  </Card>
);

export const TextHeavy = () => (
  <Card style={{ maxWidth: 440 }}>
    <CardHeader className="flex-col items-start gap-1.5">
      <CardTitle>採購標的摘要</CardTitle>
      <CardDescription>由 AI 大腦自動萃取的重點說明</CardDescription>
    </CardHeader>
    <CardContent>
      <p style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.85, margin: 0 }}>
        本案為校舍結構耐震評估後之補強統包工程，含結構補強設計、施工與監造，
        履約期限 240 日曆天。投標廠商須具備土木或結構工程相關技師簽證能力，
        並檢附近三年內同類補強實績。與本公司過往承接之耐震補強案高度相似，
        建議列為優先評估。
      </p>
    </CardContent>
  </Card>
);

export const Plain = () => (
  <Card style={{ maxWidth: 360 }}>
    <CardHeader>
      <CardTitle>今日新進標案</CardTitle>
      <CardDescription>共 12 件符合篩選條件</CardDescription>
    </CardHeader>
    <CardContent>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        12
      </div>
    </CardContent>
  </Card>
);
