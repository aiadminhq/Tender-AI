// supabase-client.js — HQ Site Log backend bridge (plain JS, no build)
// Exposes window.HQBackend. Fire-and-forget writes with an offline queue
// in localStorage ('hq.pendingSync'); the prototype's local state stays
// the source of truth for the UI, Supabase is the system of record.

(function () {
  // 連線設定由 @hq/shared 單一來源經 setup-globals 注入(桌面版 main 與 PWA 共用);
  // 保留原值作為回退,確保未經現代化 harness 直開時仍可運作。
  var SUPABASE_URL =
    window.HQ_SUPABASE_URL || "https://zsgjkcvgbfxqlihyxqbl.supabase.co";
  var SUPABASE_KEY =
    window.HQ_SUPABASE_KEY || "sb_publishable_PFrNT0UcxVYaJ0ulpskOvg_fcPCMslj";
  var QUEUE_KEY = "hq.pendingSync";

  // 工地層級旗標快取（qr_code / require_qr / require_photo）。
  // app.jsx 的 listSites 映射只保留部分欄位，會丟掉這三欄，因此改由
  // listSites 成功時就地建立 id -> flags 對照，供 worker.jsx 讀取（side channel）。
  var siteFlagsCache = {};
  function rebuildSiteFlags(rows) {
    var m = {};
    (rows || []).forEach(function (r) {
      m[r.id] = {
        qr_code: r.qr_code || null,
        require_qr: !!r.require_qr,
        require_photo: !!r.require_photo,
      };
    });
    siteFlagsCache = m;
    try {
      window.HQ_SITE_FLAGS = m;
    } catch (e) {}
  }

  var client = null;
  try {
    if (window.supabase && window.supabase.createClient) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (e) {
    console.warn("[HQBackend] init failed", e);
  }

  function readQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function writeQueue(q) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}
  }
  function enqueue(table, row) {
    var q = readQueue();
    q.push({ table: table, row: row });
    writeQueue(q);
  }

  // 具天然冪等鍵的表：重送時以 upsert + ignoreDuplicates 讓相同 event_id
  // 不會撞 unique 衝突（checkins.event_id 有 UNIQUE 約束），避免佇列永久卡住。
  var UPSERT_CONFLICT = { checkins: "event_id", outings: "event_id" };

  // 依 table 建立寫入 query：有冪等鍵者用 upsert，其餘維持 insert。
  function writeRow(table, row) {
    var conflictKey = UPSERT_CONFLICT[table];
    if (conflictKey) {
      return client
        .from(table)
        .upsert(row, { onConflict: conflictKey, ignoreDuplicates: true });
    }
    return client.from(table).insert(row);
  }

  function insert(table, row) {
    if (!client) {
      enqueue(table, row);
      return Promise.resolve({ queued: true });
    }
    return writeRow(table, row).then(
      function (res) {
        if (res.error) {
          console.warn(
            "[HQBackend] insert " + table + " failed:",
            res.error.message,
          );
          enqueue(table, row);
          return { queued: true, error: res.error };
        }
        return { ok: true };
      },
      function (err) {
        console.warn("[HQBackend] insert " + table + " network error", err);
        enqueue(table, row);
        return { queued: true };
      },
    );
  }

  // 逐筆重送離線佇列：只有成功的才從佇列移除，失敗的留待下次重試。
  // flushing 旗標避免多個觸發點（online / visibilitychange / setTimeout）併發重入。
  // 不再「先清空再重送」——改以快照長度合併 flush 期間新入列的項目，避免覆蓋遺失。
  var flushing = false;
  function flushQueue() {
    if (!client || flushing) return;
    var q = readQueue();
    if (!q.length) return;
    flushing = true;
    var remaining = [];
    var i = 0;
    function done() {
      // 合併 flush 期間（非同步等待中）新 enqueue 進來的項目，避免覆蓋遺失。
      var current = readQueue();
      var added = current.length > q.length ? current.slice(q.length) : [];
      writeQueue(remaining.concat(added));
      flushing = false;
    }
    function step() {
      if (i >= q.length) return done();
      var item = q[i++];
      writeRow(item.table, item.row).then(
        function (res) {
          if (res && res.error) remaining.push(item); // 失敗留在佇列
          step();
        },
        function () {
          remaining.push(item); // 網路錯誤留在佇列
          step();
        },
      );
    }
    step();
  }

  // Map prototype event object -> checkins row
  function checkinRow(evt, profile) {
    return {
      event_id: evt.event_id,
      action: evt.action,
      ts: (evt.time instanceof Date
        ? evt.time
        : new Date(evt.time)
      ).toISOString(),
      shift_id: evt.shift_id || null, // 配對同段 check-in/check-out（多段/跨工地）
      site_id: evt.site_id || null,
      site_name: evt.site_name || null,
      lat: evt.lat,
      lng: evt.lng,
      accuracy:
        evt.accuracy == null ? null : Math.round(evt.accuracy * 10) / 10,
      geofence: evt.geofence || "unknown",
      distance: evt.distance == null ? null : evt.distance,
      user_name: evt.user_name || (profile && profile.name) || "未具名",
      company: evt.company || (profile && profile.company) || null,
      role: (profile && profile.role) || null,
      employee_id: (profile && profile.employeeId) || null,
      case_no: evt.site_id || null, // 案號 = 工地案號（PRD M3c 自動帶入）
      is_makeup: !!evt.is_makeup,
      deadline_flag: !!evt.deadline_flag,
      photo_path: evt.photo_path || null, // 現場照片於 Storage 的路徑
      qr_payload: evt.qr_payload || null, // 掃碼到點時的 QR 內容
    };
  }

  // 上傳現場照片到私有 bucket checkin-photos，路徑固定 ${uid}/${eventId}.jpg。
  // 成功回 { path }，失敗回 { error }（不 throw，僅 console.warn）。
  // 必須在 checkin insert 前呼叫並把回傳 path 寫入 evt（checkins 無 UPDATE 權限）。
  function uploadCheckinPhoto(blob, eventId) {
    if (!client) return Promise.resolve({ error: "offline" });
    if (!blob || !eventId) return Promise.resolve({ error: "bad-args" });
    return client.auth
      .getSession()
      .then(function (r) {
        var user = r && r.data && r.data.session && r.data.session.user;
        if (!user || !user.id) return { error: "no-session" };
        var path = user.id + "/" + eventId + ".jpg";
        return client.storage
          .from("checkin-photos")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true })
          .then(function (res) {
            if (res.error) {
              console.warn(
                "[HQBackend] uploadCheckinPhoto failed:",
                res.error.message,
              );
              return { error: res.error.message };
            }
            return { path: path };
          });
      })
      .catch(function (err) {
        console.warn("[HQBackend] uploadCheckinPhoto error", err);
        return { error: String((err && err.message) || err) };
      });
  }

  // 依 MIME 推副檔名，未知一律 png（bucket 只放圖，避免奇怪副檔名）。
  function logoExtFromType(type) {
    switch (type) {
      case "image/jpeg":
      case "image/jpg":
        return "jpg";
      case "image/svg+xml":
        return "svg";
      case "image/webp":
        return "webp";
      case "image/png":
      default:
        return "png";
    }
  }

  // 上傳工地 logo 到公開 bucket site-logos，路徑 ${siteId}/logo.<ext>。
  // 僅 admin 有寫入權（RLS is_admin() 守門）。成功回 { url }（帶 cache-bust
  // query），失敗回 { error }。回傳 url 應寫入 sites.logo_url 由 saveSite 落庫。
  function uploadSiteLogo(file, siteId) {
    if (!client) return Promise.resolve({ error: "offline" });
    if (!file || !siteId) return Promise.resolve({ error: "bad-args" });
    var ext = logoExtFromType(file.type);
    var path = String(siteId) + "/logo." + ext;
    var contentType = file.type || "image/png";
    return client.storage
      .from("site-logos")
      .upload(path, file, { contentType: contentType, upsert: true })
      .then(function (res) {
        if (res.error) {
          console.warn("[HQBackend] uploadSiteLogo failed:", res.error.message);
          return { error: res.error.message };
        }
        var pub = client.storage.from("site-logos").getPublicUrl(path);
        var base = pub && pub.data && pub.data.publicUrl;
        if (!base) return { error: "no-public-url" };
        // cache-bust：logo 換圖時同路徑 upsert，需破快取才會即時更新。
        return { url: base + "?v=" + Date.now() };
      })
      .catch(function (err) {
        console.warn("[HQBackend] uploadSiteLogo error", err);
        return { error: String((err && err.message) || err) };
      });
  }

  // ---- 讀取 helpers（settings / supervisor / app 的 UI 使用）----

  // 工地清單：select * from sites order by id，回傳原始欄位。失敗回 []。
  function listSites() {
    if (!client) return Promise.resolve([]);
    return client
      .from("sites")
      .select("*")
      .order("id")
      .then(
        function (res) {
          if (res.error) {
            console.warn("[HQBackend] listSites failed:", res.error.message);
            // 真正錯誤：reject 讓呼叫端能區分「連線失敗」與「成功但無資料」。
            throw new Error(res.error.message || "listSites failed");
          }
          rebuildSiteFlags(res.data); // 就地更新工地旗標快取
          return res.data || [];
        },
        function (err) {
          console.warn("[HQBackend] listSites network error", err);
          throw err;
        },
      );
  }

  // 新增／更新工地：upsert（以 id 為 conflict key）。
  function saveSite(site) {
    if (!client) return Promise.resolve({ ok: false, error: "offline" });
    return client
      .from("sites")
      .upsert(site, { onConflict: "id" })
      .then(
        function (res) {
          if (res.error) {
            console.warn("[HQBackend] saveSite failed:", res.error.message);
            return { ok: false, error: res.error.message };
          }
          return { ok: true };
        },
        function (err) {
          console.warn("[HQBackend] saveSite network error", err);
          return { ok: false, error: String((err && err.message) || err) };
        },
      );
  }

  // 啟用／停用工地：只更新 active 欄位。
  function setSiteActive(id, active) {
    if (!client) return Promise.resolve({ ok: false, error: "offline" });
    return client
      .from("sites")
      .update({ active: !!active })
      .eq("id", id)
      .then(
        function (res) {
          if (res.error) {
            console.warn(
              "[HQBackend] setSiteActive failed:",
              res.error.message,
            );
            return { ok: false, error: res.error.message };
          }
          return { ok: true };
        },
        function (err) {
          console.warn("[HQBackend] setSiteActive network error", err);
          return { ok: false, error: String((err && err.message) || err) };
        },
      );
  }

  // 開發日誌：order by released_at desc, id desc。失敗回 []。
  function listChangelogs() {
    if (!client) return Promise.resolve([]);
    return client
      .from("changelogs")
      .select("*")
      .order("released_at", { ascending: false })
      .order("id", { ascending: false })
      .then(
        function (res) {
          if (res.error) {
            console.warn(
              "[HQBackend] listChangelogs failed:",
              res.error.message,
            );
            // 真正錯誤：reject 讓呼叫端能區分「連線失敗」與「成功但無資料」。
            throw new Error(res.error.message || "listChangelogs failed");
          }
          return res.data || [];
        },
        function (err) {
          console.warn("[HQBackend] listChangelogs network error", err);
          throw err;
        },
      );
  }

  // 新增／更新開發日誌（以 version 為 conflict key，RLS 僅 admin 可寫入）。
  function saveChangelog(entry) {
    if (!client) return Promise.resolve({ ok: false, error: "offline" });
    return client
      .from("changelogs")
      .upsert(
        {
          version: entry.version,
          released_at: entry.released_at,
          title: entry.title,
          items: entry.items || [],
        },
        { onConflict: "version" },
      )
      .then(
        function (res) {
          if (res.error) {
            console.warn(
              "[HQBackend] saveChangelog failed:",
              res.error.message,
            );
            return { ok: false, error: res.error.message };
          }
          return { ok: true };
        },
        function (err) {
          console.warn("[HQBackend] saveChangelog network error", err);
          return { ok: false, error: String((err && err.message) || err) };
        },
      );
  }

  // checkins row -> 前端 record 物件（形狀對齊 worker.jsx recordEvent）
  function recordFromRow(row) {
    return {
      event_id: row.event_id,
      action: row.action,
      time: new Date(row.ts),
      shift_id: row.shift_id || null, // 欄位未上線前為 undefined→null，前端安全忽略
      site_id: row.site_id,
      site_name: row.site_name,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy,
      geofence: row.geofence || "unknown",
      distance: row.distance,
      user_name: row.user_name,
      company: row.company,
      role: row.role,
      employee_id: row.employee_id,
      department: row.department,
      case_no: row.case_no,
      is_makeup: !!row.is_makeup,
      note: row.note,
      photo_path: row.photo_path || null,
      qr_payload: row.qr_payload || null,
    };
  }

  // 打卡紀錄：order by ts desc limit N，映射成前端 record 形狀。失敗回 []。
  function listCheckins(opts) {
    var limit = (opts && opts.limit) || 200;
    if (!client) return Promise.resolve([]);
    return client
      .from("checkins")
      .select("*")
      .order("ts", { ascending: false })
      .limit(limit)
      .then(
        function (res) {
          if (res.error) {
            console.warn("[HQBackend] listCheckins failed:", res.error.message);
            // 真正錯誤：reject 讓呼叫端能區分「連線失敗」與「成功但無資料」。
            throw new Error(res.error.message || "listCheckins failed");
          }
          return (res.data || []).map(recordFromRow);
        },
        function (err) {
          console.warn("[HQBackend] listCheckins network error", err);
          throw err;
        },
      );
  }

  // ---- 外出申請（outings）----

  // 表單的 datetime-local 值（"2026-07-27T14:30"，本地時區）、ISO 字串、
  // Date 物件都收；無法解析時回 null 交給後端 not null 約束擋下。
  function toIso(v) {
    if (!v) return null;
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // 外出申請清單。回傳原始 row（尚無前端 record 形狀，由呼叫端決定）。
  // opts.mine：只看自己的申請。一般員工受 RLS 限制本來就只讀得到自己的，
  // 這個參數是給審核者用的（Phase 2 的「我的申請 / 待審清單」切換）。
  function listOutings(opts) {
    var limit = (opts && opts.limit) || 200;
    if (!client) return Promise.resolve([]);
    var mine = !!(opts && opts.mine);
    var uidPromise = mine
      ? client.auth.getSession().then(function (r) {
          return (r.data.session && r.data.session.user.id) || null;
        })
      : Promise.resolve(null);
    return uidPromise.then(function (uid) {
      var q = client
        .from("outings")
        .select("*")
        .order("start_ts", { ascending: false })
        .limit(limit);
      if (uid) q = q.eq("user_uid", uid);
      return q.then(
        function (res) {
          if (res.error) {
            console.warn("[HQBackend] listOutings failed:", res.error.message);
            throw new Error(res.error.message || "listOutings failed");
          }
          return res.data || [];
        },
        function (err) {
          console.warn("[HQBackend] listOutings network error", err);
          throw err;
        },
      );
    });
  }

  // 同事名冊（職務代理人／簽核代理人下拉用）。profiles 的 RLS 只允許讀自己，
  // 所以走 admin-users Edge Function 的 roster action，只拿 id / name / department。
  function listRoster() {
    if (!window.HQAuth) return Promise.resolve([]);
    return window.HQAuth.invoke({ action: "roster" }).then(function (res) {
      if (res && res.error) {
        console.warn("[HQBackend] listRoster failed:", res.error);
        throw new Error(res.error);
      }
      return (res && res.roster) || [];
    });
  }

  window.HQBackend = {
    enabled: !!client,
    saveCheckin: function (evt, profile) {
      if (
        !evt ||
        (evt.action !== "check-in" &&
          evt.action !== "check-out" &&
          evt.action !== "permission-denied")
      )
        return Promise.resolve({ skipped: true });
      return insert("checkins", checkinRow(evt, profile));
    },
    saveCorrection: function (req, profile, site) {
      return insert("corrections", {
        event_id: req.event_id || null,
        user_name: (profile && profile.name) || "未具名",
        company: (profile && profile.company) || null,
        employee_id: (profile && profile.employeeId) || null,
        site_id: (site && site.id) || null,
        action: req.action === "check-out" ? "check-out" : "check-in",
        requested_ts: new Date(req.date + "T" + req.time + ":00").toISOString(),
        reason: req.reason || "",
      });
    },
    // 外出申請。比照 saveCorrection 走 insert()：失敗自動入離線佇列，
    // 重送時靠 event_id（outings.event_id 有 UNIQUE，見 UPSERT_CONFLICT）去重。
    // user_uid 不由前端帶，交給 DB 欄位預設 auth.uid()，與 checkins/corrections 一致。
    saveOuting: function (req, profile, site) {
      return insert("outings", {
        event_id: (req && req.event_id) || null,
        user_name: (profile && profile.name) || "未具名",
        site_id: (site && site.id) || (req && req.site_id) || null,
        start_ts: toIso(req && req.start_ts),
        end_ts: toIso(req && req.end_ts),
        reason: (req && req.reason) || "",
        itinerary: (req && req.itinerary) || "",
        deputy_uid: (req && req.deputy_uid) || null,
        approver_uid: (req && req.approver_uid) || null,
        attachment_path: (req && req.attachment_path) || null,
      });
    },
    saveFeedback: function (message, category, profile) {
      return insert("feedback", {
        user_name: (profile && profile.name) || null,
        company: (profile && profile.company) || null,
        category: category || "general",
        message: message,
        page: location.hash || null,
        ua: navigator.userAgent,
      });
    },
    flushQueue: flushQueue,
    uploadCheckinPhoto: uploadCheckinPhoto,
    uploadSiteLogo: uploadSiteLogo,
    // 讀取某工地的層級旗標；listSites 尚未載入時回傳安全預設（皆 false）。
    siteFlags: function (id) {
      return (
        siteFlagsCache[id] || {
          qr_code: null,
          require_qr: false,
          require_photo: false,
        }
      );
    },
    listSites: listSites,
    saveSite: saveSite,
    setSiteActive: setSiteActive,
    listCheckins: listCheckins,
    listOutings: listOutings,
    listRoster: listRoster,
    listChangelogs: listChangelogs,
    saveChangelog: saveChangelog,
  };

  // ---- Auth bridge（auth.jsx 使用）----
  window.HQSupabase = client;
  window.HQAuth = client
    ? {
        getSession: function () {
          return client.auth.getSession();
        },
        onAuthStateChange: function (cb) {
          return client.auth.onAuthStateChange(cb);
        },
        signIn: function (email, password) {
          return client.auth.signInWithPassword({
            email: email,
            password: password,
          });
        },
        signInWithGoogle: function () {
          return client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: location.origin + location.pathname },
          });
        },
        // 通用第三方登入：provider 由前端傳入（"google" / "notion" / "azure" …）。
        // 只要在 Supabase 後台啟用對應 provider，前端 OAUTH_PROVIDERS 加一筆即可，
        // 這裡不需再改。redirectTo 一律回到本頁，returnTo 後由 useAuth 接手導流。
        signInWithOAuth: function (provider) {
          return client.auth.signInWithOAuth({
            provider: provider,
            options: { redirectTo: location.origin + location.pathname },
          });
        },
        signOut: function () {
          return client.auth.signOut();
        },
        // 以目前 session 使用者找 profile（本人 id 或任一 provider 綁定 uid）。
        // 新增 provider 時在此 orExpr 補一個綁定欄位即可（與後端 OAUTH_COLS 對齊）。
        fetchProfile: function () {
          return client.auth.getSession().then(function (r) {
            var user = r.data.session && r.data.session.user;
            if (!user) return null;
            var orExpr = [
              "id.eq." + user.id,
              "google_uid.eq." + user.id,
              "notion_uid.eq." + user.id,
            ].join(",");
            return client
              .from("profiles")
              .select("*")
              .or(orExpr)
              .maybeSingle()
              .then(function (res) {
                return res.data || null;
              });
          });
        },
        // admin-users Edge Function（自動附帶 session token）
        invoke: function (body) {
          return client.functions
            .invoke("admin-users", { body: body })
            .then(function (res) {
              if (res.error) {
                // FunctionsHttpError：從 response body 取出錯誤訊息
                if (
                  res.error.context &&
                  typeof res.error.context.json === "function"
                ) {
                  return res.error.context
                    .json()
                    .then(function (j) {
                      return { error: (j && j.error) || res.error.message };
                    })
                    .catch(function () {
                      return { error: res.error.message };
                    });
                }
                return { error: res.error.message };
              }
              return res.data || {};
            });
        },
      }
    : null;

  // 離線佇列的送出時機（跨平台）：恢復連線、App 重新可見、載入後 3 秒。
  // 註：queue 存於 localStorage（重開仍在，不會遺失打卡）。未採用
  // SW Background Sync，因 iOS Safari 不支援、且 SW 無法讀 localStorage；
  // 頁面端多點觸發已能涵蓋現場「離線打卡→稍後恢復」的實際情境。
  window.addEventListener("online", flushQueue);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && navigator.onLine)
      flushQueue();
  });
  setTimeout(flushQueue, 3000);
})();
