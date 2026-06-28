# Phase 2 真鑑權設計（HMAC 簽章 token）

> 日期：2026-06-25 ｜ 分支：`claude/busy-sagan-gm197s` ｜ 範圍：`be` + `fe`
> 目標：多人共享內網時，**具名 Layer B 貢獻與 admin 權限不可偽造**。
> 前置：本設計是「先補真鑑權再開放內網試用」的前置工程；部署（LAN）為後續另案。

---

## 1. 問題與信任邊界缺口

目前登入只驗密碼，**不簽發任何憑證**：

- `/me/*` 端點的身分由 query／body 帶入的 `user_id`，**完全未驗證** → 送 `user_id=<任何人>` 即可冒充任何人、偽造具名 Layer B 貢獻。
- `require_admin` 只檢查 `X-User-Role: admin` 標頭 → 任何人加一個標頭就成為 admin（可開白名單、重設他人密碼）。

Phase 2 目標：登入簽發**可驗證（簽章、防竄改、帶到期）的憑證**；後端從憑證推導身分／角色，取代「信任前端帶入的 `user_id` 與 `X-User-Role`」。

---

## 2. 採用方案：無狀態 HMAC 簽章 token（stdlib）

評估三案後採 **A**：

- **A（採用）** stdlib HMAC 簽章 token ＋ `Authorization: Bearer`：零新相依、離線、與 `security.py` 既有 pbkdf2 同調、可逆、改動最小。
- B 伺服器端 session（DB 表）：唯一賣點「即時撤銷」對 9 人內網試用為 YAGNI。
- C PyJWT：加相依、違背 `security.py` 刻意全 stdlib 的決定；本 HMAC token 本質即一顆最小 JWT，日後要升 JWT/SSO 只改 `auth.py` 一處。

### 2.1 Token 機制 — 新檔 `app/core/auth.py`

- **格式**：`base64url(payload).base64url(hmac_sha256(payload, AUTH_SECRET))`
- **payload**：`{"uid": <int>, "exp": <unix>, "iat": <unix>}`
- **關鍵：token 只放 `uid`，不放 role**。每次請求解出 `uid` 後**從 DB 即時撈 `User`**，取得最新 `role` 與 `whitelist_active`。
  - 效果：admin 降級某人或移出白名單，**下一個請求即生效**，不必等 token 到期——以一次 DB 查詢換到「近即時撤銷」，免開 session 表。
- **API**：
  - `issue_token(user) -> str`
  - `decode_token(token) -> dict | None`：驗簽（`hmac.compare_digest`）＋驗 `exp`；壞的／過期回 `None`。
- 純 stdlib（`hmac`/`hashlib`/`base64`/`json`），不加任何相依。

### 2.2 祕密與到期

- **`AUTH_SECRET`**：放 `.env`（gitignored），**無安全預設值**；缺值時 `issue_token`／`decode_token` 直接 `raise`（避免空祕密誤上線）。
  - `.env.example` 附「如何產一把」（如 `python -c "import secrets; print(secrets.token_urlsafe(48))"`）。
  - 測試由 `conftest` 注入測試值。
  - **換掉 `AUTH_SECRET` ＝ 一次廢掉所有既有 token**（撤銷後手）。
- **TTL**：`AUTH_TOKEN_TTL_HOURS`，預設 `168`（7 天）；過期重新登入。
- **不做** refresh token、**不做** session 表（YAGNI）。

---

## 3. 後端身分依賴（取代「信任前端」）

新增兩個 FastAPI dependency（置於新檔 `app/core/auth.py`；`security.py` 維持只放密碼／API key 等原語）：

- `get_current_user(authorization: Bearer, session) -> User`
  - 無／非 `Bearer ` / 壞 / 過期 token → **401**
  - 查無此 `uid` → **401**
  - `whitelist_active is False`（被停用／移出白名單）→ **403**
  - 否則回傳 `User`
- `require_admin_user`：先 `get_current_user`，再檢查 `user.role == "admin"`，否則 **403**。**完全不看 `X-User-Role` 標頭**。

`X-API-Key`（`require_api_key`）**保留為外層粗閘**；token 是內層具名身分層。識別／寫入類請求＝兩者都要。

### 3.1 端點改動

| 端點                                                                                                                                                         | 改法                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`                                                                                                                                           | 驗密成功後**簽發 token**；`LoginOut` 新增 `token` + `expires_at`。登入本身免 token。                                                         |
| `GET /me`                                                                                                                                                    | 身分改由 token 推導；**移除 `user_id` query**。成為「驗 token＋取本人帳號」端點（前端開站驗證用）。                                          |
| `PUT /me/consent`、`PUT /me/password`、`GET /me/preference-profile`、`GET /me/abandoned-keyword-candidates`、`GET /me/tender-decisions`、`POST /me/keywords` | 一律 `Depends(get_current_user)`，`user_id` 取自 token，**丟棄前端帶入的 user_id**。改密那條的「驗證呼叫端確為本人」TODO 由 token 自然解決。 |
| `/admin/*`（whitelist、改他人密碼）                                                                                                                          | `Depends(require_admin_user)`，role 由 DB 推導；**移除 `X-User-Role`**。                                                                     |
| **寫入行為**端點（events / evaluate / tender 狀態 / saved-searches / manual keywords）                                                                       | 同樣 `Depends(get_current_user)`，`user_id` 取自 token——這是「偽造 user_id 即偽造具名 Layer B」的關口，必須堵死。                            |

### 3.2 強制 token 的邊界（surgical）

- **強制 token**：`/me/*`、`/admin/*`、上述行為寫入端點。
- **維持只靠 X-API-Key**：唯讀 Layer A（標案列表、reasoning 解釋等公開資料）——避免打斷 MCP／自動化既有用 X-API-Key 讀公開資料的路徑。
- 「人必須登入才能用」由**前端登入閘**保證（§4），後端則確保具名貢獻的身分完整性。

---

## 4. 前端改動（落實「一律須登入」）

- **Token 儲存**：登入回應的 `token` 存 `localStorage`（key `auth-token`）；登出清除。
- `api.ts` 的 `authHeaders()`：有 token 即加 `Authorization: Bearer <token>`（與 `X-API-Key` 並存）；**移除 `/me/*` 與行為寫入的 `user_id` 注入**（後端改由 token 認定，前端再送是死碼）。
- `auth-context`：開站時用 token 打 `GET /me` 驗證；**401 即自動登出清 token**。
- **示範模式（mock 後門）**：以 `import.meta.env.DEV` 包起來——本地 `vite dev` 仍可一鍵示範；正式 `vite build` 的部署版 `DEV=false`，**後門不存在**。符合「部署版移除後門」又不犧牲本地開發便利。
- **登入閘**：`status !== "authed"` 一律顯示登入頁，**無匿名瀏覽**；App 外殼僅在登入後渲染。
- admin 呼叫（`adminSetPassword` / `fetchAccounts` / `setWhitelist`）：**拿掉 `X-User-Role: admin` 標頭**，改靠 Bearer token。

---

## 5. 同意模型（團隊協議＝操作即同意，opt-out）

> 本節為 owner 知情之 Layer B 治理決定（2026-06-25）：團隊已協議「白名單帳號**登入操作本站**，即視為同意共享其資訊與行為」。建議由 admin（Christian／Aaron）追認存查。

- **保留** `consent_shared` 欄位與 consent-aware 學習閘（`whitelist_active && consent_shared`）、append-only 審計與可回退安全網——**不動架構，只改預設值方向**。
- `seed_members.py`：
  - **新建帳號**的 `consent_shared = True`（反映團隊協議）。
  - **既有帳號**：**不觸碰** `consent_shared`（永不覆蓋個人的 opt-out），與既有「密碼僅在未設定時才寫」哲學一致。
  - 同步更新檔頭註解（原「第 2 段本人同意不可代為」改述為「依團隊協議預設同意，個人可於設定頁退出」）。
- **設定頁**：既有同意開關（`PUT /me/consent`）改以 **opt-out** 框架呈現——預設開啟，任何人可自行關閉「退出共享」。
- 紅線不變：對非白名單**永不揭露**；對外匯出去識別化。

---

## 6. 錯誤處理

- **401**（缺／壞／過期 token）：前端攔截 → 清 token、導回登入頁、提示「請重新登入」。
- **403**（非 admin／帳號被停用）：顯示「權限不足」或「帳號已停用，請洽管理員」。
- 後端沿用既有例外型別（`PermissionDenied` 等），維持一致回應格式。

---

## 7. 測試

- **新增** `tests/test_auth_token.py`：簽發／驗簽／過期／竄改（改一 byte 應失敗）／role 取自 DB／`whitelist_active=False` 回 403／缺 `AUTH_SECRET` 應 raise。
- `conftest`：加 `auth_headers(user)` fixture（回 `{"Authorization": f"Bearer {issue_token(user)}", **api_key_header}`）；注入測試用 `AUTH_SECRET`。
- **既有 ~8 個測試檔**：
  - `ADMIN = {"X-User-Role": "admin"}` → 換成 admin user 的 token headers。
  - `params={"user_id": ...}` / body 帶 `user_id` → 換成該 user 的 auth headers。
  - 影響檔：`test_auth_api.py`、`test_account_api.py`、`test_abandoned_keywords.py`、`test_behavior_api.py`、`test_tender_decisions.py`、`test_manual_keywords.py`、`test_decision_search.py`、`test_evolution.py`。
- 目標仍全綠（後端 370+、前端 54+）。

---

## 8. 部署相依（後續另案，先記）

- 正式 DB 跑 `uv run python -m app.jobs.seed_members` → David（`david.tsai@hqdesign.tw`）等帳號就緒（預設密碼 `admin`，登入後請改；`consent_shared=True`）。
- `.env` 新增 `AUTH_SECRET`（強隨機）、`AUTH_TOKEN_TTL_HOURS=168`。
- 更新 `auth.py` / `me.py` / `admin.py` 的「Phase 2 TODO」docstring 為「已完成」。
- **首位測試者**：David 為主要測試者。

---

## 9. Layer B 三項揭露（精簡）

- **①同意基礎**：白名單（@hqdesign.tw）帳號登入操作本站，即依**團隊協議**視為同意共享其資訊與行為；token 確保此同意**可證明綁定具名帳號、不可偽造**。個人可於設定頁退出。
- **②共享範圍**：白名單內、依登入帳號**具名**共享。
- **③對外隔離**：對非白名單**永不揭露**；`AUTH_SECRET` 只進 `.env`、token 不入 log；對外匯出一律去識別化。

---

## 10. 不做（YAGNI）

- refresh token、伺服器端 session／撤銷清單、多裝置管理、SSO/OAuth、密碼複雜度政策強化（沿用現有 `MIN_PASSWORD_LENGTH`）。
- 唯讀 Layer A 端點的 token 強制（維持 X-API-Key）。
