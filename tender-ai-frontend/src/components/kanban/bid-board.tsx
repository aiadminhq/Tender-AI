// 投標看板：五欄（觀望→備標中→已投標→得標→放棄）+ 單例 TenderDrawer。
// Issue #2：卡片有 tenderId → 設 openTenderId → 側拉抽屜開啟對應標案，留在看板不離頁。
// 注意：連線時 useAppData().tenders 會被換成後端標案（id 為數字字串如 "3556"），
// 與種子專案的 mock tenderId（t-001…）不同 id 空間；故用 resolveTender 回退 mock
// TENDERS，確保種子卡在連線狀態下仍能開啟詳情（修正點不開抽屜的回歸）。
import { useState } from "react";
import { useAppData } from "@/store/app-data";
import { TENDERS } from "@/data/tenders";
import { resolveTender } from "@/store/board-logic";
import { TenderDrawer } from "@/components/tenders/tender-drawer";
import { BID_STAGE_ORDER } from "@/types/domain";
import { ProjectColumn } from "./project-column";

export function BidBoard() {
  const { tenders } = useAppData();
  const [openTenderId, setOpenTenderId] = useState<string | null>(null);
  const selected = resolveTender(openTenderId, tenders, TENDERS);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BID_STAGE_ORDER.map((stage) => (
          <ProjectColumn
            key={stage}
            stage={stage}
            onOpenTender={setOpenTenderId}
          />
        ))}
      </div>
      <TenderDrawer tender={selected} onClose={() => setOpenTenderId(null)} />
    </>
  );
}
