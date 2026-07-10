import json
import urllib.request
import urllib.parse
import os
import time

API_KEY = "AQ.Ab8RN6LXjCYCgRxslktGLbYEp04KEgxox6EXZU8YgoDjAfVX1A"
PROJECT_ID = "5757726888608838473"

# 定義 4 個高階生成任務 (加入 Vercel / Stripe 風格的極致留白與數據圖表)
TASKS = [
    {
        "page": "dashboard_v2",
        "style": "warm_bento",
        "prompt": """一個為 Tender AI 重新設計的「首頁指揮中心」高階 Bento 網頁。
目標：推翻傳統擁擠排版，參考 Vercel 與 Stripe Dashboard 的高雅美學。強調極致的留白 (Spacious layout)、乾淨的字級節奏、與高質感的數據視覺化圖表。

[STYLE: Premium Warm Bento]
Atmosphere: Generous whitespace, elegant editorial rhythm, clean orange accents.
Colors: Canvas (#FBFBFA, warm neutral paper tone), Surface (#FFFFFF), Accent (#F97316), Text (#18181B), Border (#F1F1F0).
Geometry: Cards rounded-2xl (16px), Buttons rounded-full (capsule) or rounded-xl. Fine 1px borders, whisper-soft shadow (0 1px 2px rgba(0,0,0,0.03)).
Typography: Noto Sans TC & Inter. High typographical scale contrast. Keep spacing open.

Page Structure:
1. Header: Sleek, high-padding navigation bar with a subtle divider line. Left: "Tender AI" in a semi-bold display font. Right: David's profile showing a clean green dot saying "White-listed | Layer B Consent Enabled".
2. KPI Stats Bento Row (Generous Spacing, p-8 inside cards, gap-8):
   - Card A (1/3 width): "Daily Ingestion". Large display number "142" (text-5xl, tracking-tight, font-semibold) with inline trend badge "+12% today". Underneath, a beautiful inline SVG mini line chart (sparkline) in orange representing weekly tender flow.
   - Card B (1/3 width): "Active Bid preparation". Large display number "8" in warm orange accent. Underneath, a clean horizontal progress bar (16px tall) with rounded-full geometry.
   - Card C (1/3 width): "AI Brain health". Display status "Evolving (運作中)". Show a beautiful SVG gauge meter representing the 50-sample evolution threshold (currently at 64 samples).
3. Main Work Area (Two-column layout, gap-8):
   - Left Panel (2/3 width, major Bento Card): "Today's High Feasibility Tenders". Only show 3 high-value tenders, giving each tender plenty of vertical padding (py-6).
     * Row 1: Title "醫院衛浴更新與感控改善工程" (Budget: 3,360萬 | 12 days left). Show a gorgeous semi-circular gauge displaying "76% Feasibility" in orange, followed by a clean, light-gray text attribution block: "Reason: High match with past engineering cases". Actions are clean capsule buttons: "[✓ Accept]" (filled orange button) and "[✗ Ignore]" (light border button).
     * Row 2: "北醫大樓天花板修繕採購" (Budget: 450萬 | 4 days left) at 82%.
   - Right Panel (1/3 width):
     * Upper Card: "Active Rules Distribution". A premium double-ring SVG donut chart showing the proportions of active filters (Budget limit, excluded days, budget comfort zones) with a clean legend.
     * Lower Card: "Team Collaborative Activity (Layer B)". A high-padding timeline showing Christian Wu (24 ratings) and Aaron (12 ratings) activity with beautiful avatars and clean timestamps.
4. Floating Agent Widget: A minimal FAB in the bottom right corner with a message icon, saying "Tender Assistant ready".
"""
    },
    {
        "page": "dashboard_v2",
        "style": "dark_spatial",
        "prompt": """A Dark Spatial Amber style Dashboard Hub for "Tender AI".
Reflecting the aesthetic of premium dark interfaces like Linear and Vercel dark mode. Extremely spacious layout, glassmorphism surfaces, and neon amber glowing gauges.

Colors: Canvas (#09090B), Surface (rgba(20,20,23,0.6) with backdrop blur), Accent (#F59E0B), Text (#FAFAFA), Border (rgba(255,255,255,0.06)).
Geometry: Cards rounded-2xl (16px), Buttons rounded-lg. Soft amber glowing shadows.

Page Structure:
1. Header: Transparent nav bar with 64px height. Title "Tender AI". Right profile avatar with a yellow glowing status point.
2. Metrics Row (gap-8, p-8):
   - Card 1: "Tender Intake". Massive text "142" in JetBrains Mono font. Below, a beautiful glowing SVG neon line chart (sparkline) with a subtle orange gradient drop.
   - Card 2: "In Progress Bids". Metric "8" with a glowing amber badge.
   - Card 3: "AI Database Evolution". Monospace status "EVOLVING_ACTIVE (64/50)".
3. Two-Column Dashboard (gap-8):
   - Left (2/3 width card): "Priority Bid Focus". Generous vertical padding for rows.
     * Row 1: "醫院衛浴更新與感控改善工程" (3,360萬 | 12d). Displays a stunning neon-orange circular progress gauge filled at 76%. Sleek action buttons: "Accept" (glowing amber) and "Ignore" (dark outline).
     * Row 2: "北醫大樓天花板修繕採購" (450萬 | 4d) at 82%.
   - Right (1/3 width panel):
     * Card A: "Active Focus & Avoidance rules". Minimalist list of tags with subtle glowing borders.
     * Card B: "Layer B Contributor activity". Displays team stats with neon indicators.
4. Floating assistant trigger FAB with amber pulse effect.
"""
    },
    {
        "page": "tenders_v2",
        "style": "warm_bento",
        "prompt": """一個重新設計的「標案超級清單」高階 Bento 網頁。
目標：解決資訊擁擠問題。參考 Stripe Dashboard 的表格與篩選器設計，提升留白、使用極簡細邊框線、以及乾淨的表單控制件。

[STYLE: Premium Warm Bento]
Atmosphere: Generous padding, thin borders, sleek typography, clean orange accent.
Colors: Canvas (#FBFBFA), Surface (#FFFFFF), Accent (#F97316), Text (#18181B), Border (#E4E4E7).

Page Structure:
1. 左側篩選控制台 (1/4 寬, 獨立懸浮卡片):
   - 帶有大內邊距 (p-6) 的篩選面板。
   - 預算門檻控制：包含一個極簡的滑桿 (Slider) 元件，上方數值「最高 5000 萬」大字顯示。
   - 標案類型：綠/藍/紫三色標籤篩選器，按鈕圓角 rounded-lg。
   - 特徵關鍵字編輯區：分為「重點加權」與「避免排除」區塊，標籤帶有精細的 x 刪除鈕，周圍留白足夠。
   - 底部有一個極簡的 Switch 開關：「自動排除 7 天內即將截止案件」。
2. 右側高密度超級表格 (3/4 寬, 獨立大卡片):
   - 頂部顯示「已過濾 42 筆高潛力標案」。右側有排序下拉選單 (按截止日、按可行性評分)。
   - 清單列表。每一行 (Row) 具有 72px 的高度，左右內邊距 px-6，行與行之間有淡灰細線分隔：
     * 左側：機關名稱「衛生福利部」與精巧的綠色「工程」類別徽章。標案標題「衛福部大樓裝修工程」以 14px 粗體文字顯示。
     * 中間：預算「1,200 萬」與截止日期「2026-07-12 (剩餘 12 天)」。
     * 右側：一個高雅的圓環進度計，綠色高亮「92%」，旁邊是承接 (✓ Accept) 與略過 (✗ Ignore) 兩個膠囊按鈕，按鈕高度 32px，視覺輕盈。
3. 底部 Pagination：極簡的 "Prev" 和 "Next" 按鈕，帶有頁碼指示器。
"""
    },
    {
        "page": "tenders_v2",
        "style": "dark_spatial",
        "prompt": """A Dark Spatial Amber styled Tender list and filter bar page for "Tender AI".
High-end dark dashboard aesthetic with massive padding, glassmorphism list rows, and glowing filter controls.

Colors: Canvas (#09090B), Surface (rgba(20,20,23,0.6) with blur), Accent (#F59E0B), Text (#FAFAFA), Border (rgba(255,255,255,0.06)).

Page Structure:
1. Left Filter Widget (1/4 width):
   - Frost glass panel with sleek slider for budget threshold.
   - Segmented buttons for Category filtering with glowing icons.
   - Keyword tags area with neon orange borders.
2. Right Super Table (3/4 width):
   - Top banner showing "42 matching tenders found" in light gray text.
   - List of tenders with 80px row height and wide gap between items.
   - Each row contains:
     * Title "衛福部大樓裝修工程" in bold white.
     * Category indicator colored tag.
     * Budget "1,200 萬" in monospace.
     * Circular glowing gauge displaying feasibility "92%".
     * Actions: Small elegant "Accept" and "Ignore" buttons.
3. Pagination controls at the bottom with dark border outlines.
"""
    }
]

def make_mcp_call(method, arguments):
    url = "https://stitch.googleapis.com/mcp"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY
    }
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": "tools/call",
        "params": {
            "name": method,
            "arguments": arguments
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as res:
            response_data = json.loads(res.read().decode("utf-8"))
            return response_data
    except Exception as e:
        print(f"API Call failed: {e}")
        return None

def download_file(url, save_path):
    print(f"Downloading {url} to {save_path}...")
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    
    if save_path.endswith(".png") and "=" not in url:
        url += "=w1440"
        
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req) as response:
            with open(save_path, "wb") as f:
                f.write(response.read())
        print("Download complete.")
        return True
    except Exception as e:
        print(f"Download failed: {e}")
        return False

def find_urls_in_json(obj):
    html_url = None
    screenshot_url = None
    
    if isinstance(obj, dict):
        if "htmlCode" in obj and isinstance(obj["htmlCode"], dict) and "downloadUrl" in obj["htmlCode"]:
            html_url = obj["htmlCode"]["downloadUrl"]
        if "screenshot" in obj and isinstance(obj["screenshot"], dict) and "downloadUrl" in obj["screenshot"]:
            screenshot_url = obj["screenshot"]["downloadUrl"]
            
        for k, v in obj.items():
            h, s = find_urls_in_json(v)
            if h: html_url = h
            if s: screenshot_url = s
    elif isinstance(obj, list):
        for item in obj:
            h, s = find_urls_in_json(item)
            if h: html_url = h
            if s: screenshot_url = s
            
    return html_url, screenshot_url

def main():
    print(f"Starting V2 batch generation on project: {PROJECT_ID}")
    
    for i, task in enumerate(TASKS):
        page = task["page"]
        style = task["style"]
        prompt = task["prompt"]
        
        print(f"\n[{i+1}/{len(TASKS)}] Generating {page} in style {style} (Premium V2)...")
        
        arguments = {
            "projectId": PROJECT_ID,
            "prompt": prompt,
            "deviceType": "DESKTOP",
            "modelId": "GEMINI_3_1_PRO"
        }
        
        response = make_mcp_call("generate_screen_from_text", arguments)
        if not response:
            print(f"Failed to call API for task: {page} ({style})")
            continue
            
        debug_path = f".stitch/designs/{style}/{page}_response.json"
        os.makedirs(os.path.dirname(debug_path), exist_ok=True)
        with open(debug_path, "w", encoding="utf-8") as f:
            json.dump(response, f, indent=2, ensure_ascii=False)
            
        html_url = None
        screenshot_url = None
        
        try:
            html_url, screenshot_url = find_urls_in_json(response)
            if (not html_url or not screenshot_url) and "result" in response and "content" in response["result"]:
                for content_item in response["result"]["content"]:
                    if content_item.get("type") == "text":
                        inner_json = json.loads(content_item["text"])
                        h, s = find_urls_in_json(inner_json)
                        if h: html_url = h
                        if s: screenshot_url = s
        except Exception as parse_error:
            print(f"Error parsing response: {parse_error}")
            
        if html_url and screenshot_url:
            html_path = f".stitch/designs/{style}/{page}.html"
            png_path = f".stitch/designs/{style}/{page}.png"
            
            download_file(html_url, html_path)
            download_file(screenshot_url, png_path)
            print(f"SUCCESS: Generated and saved {page} ({style})")
        else:
            print(f"WARNING: Generation succeeded but download URLs not found in response for {page} ({style})")
            
        time.sleep(5)

if __name__ == "__main__":
    main()
