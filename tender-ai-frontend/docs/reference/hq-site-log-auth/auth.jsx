// auth.jsx — 真實登入流程（Supabase Auth）
// LoginView / BindCompanyView / FirstSetupView + useAuth
// 沿用 app.css 的 locked-* 樣式。

// HQ Design 品牌標誌（來源：HQ-logo/export/HQ-logo.svg，vermillion 單色）
// 顏色走 currentColor，由外層 .login-logo 控制色彩與尺寸。
const HQLogoMark = ({ size = 64 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="HQ Design"
    role="img"
  >
    <path
      d="M678.995 420H520.334L490.889 369H649.55L678.995 420Z"
      fill="currentColor"
    />
    <path
      d="M822 420V745H707.974L737.418 796H873V369H747.263L776.708 420H822Z"
      fill="currentColor"
    />
    <path
      d="M263.301 279L233.856 228H568.144L597.589 279H263.301Z"
      fill="currentColor"
    />
    <path d="M582 228L692.851 420H762.851L652 228H582Z" fill="currentColor" />
    <path
      d="M201 340.334L150 251.999V646H553.103L523.658 595H201V340.334Z"
      fill="currentColor"
    />
    <path d="M220 228H150L354.959 583H424.959L220 228Z" fill="currentColor" />
    <path
      d="M723.562 796L432 291H362L653.562 796H723.562Z"
      fill="currentColor"
    />
    <path
      d="M344.716 420L315.216 369H393.216L422.569 420H344.716Z"
      fill="currentColor"
    />
  </svg>
);

// GoogleLogo 已移至 shared.jsx 共用（OAUTH_PROVIDERS 的 Logo 直接引用）。

const NotionLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#000" />
    <path fill="#fff" d="M8 7.2h2.2l4 6.1V7.2H16v9.6h-2.1l-4.1-6.3v6.3H8z" />
  </svg>
);

/* ============================================================
   OAUTH_PROVIDERS — 第三方登入設定（資料驅動）
   新增 provider 只要在此加一筆，並在 Supabase 後台
   （Authentication → Providers）啟用同名 provider 即可，
   LoginView 會自動長出對應按鈕、supabase-client 也不必改。
   enabled=false 時按鈕不顯示（後台尚未設定完成時保持 false）。
   ============================================================ */
const OAUTH_PROVIDERS = [
  {
    id: "google",
    name: "Google",
    label: "使用 Google 帳號登入",
    Logo: GoogleLogo,
    enabled: true,
  },
  {
    id: "notion",
    name: "Notion",
    label: "使用 Notion 帳號登入",
    Logo: NotionLogo,
    enabled: false, // Supabase 後台填好 client ID/secret 並啟用後改 true
  },
];

/* ============================================================
   useAuth — session + profile 狀態機
   status: loading | signedout | bind | setup | ready
   ============================================================ */
function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = 尚未確認
  const [profile, setProfileState] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!window.HQAuth) {
      setSession(null);
      return;
    }
    let sub = null;
    HQAuth.getSession().then(({ data }) => setSession(data.session || null));
    const res = HQAuth.onAuthStateChange((_event, s) => setSession(s || null));
    sub = res.data && res.data.subscription;
    return () => {
      if (sub) sub.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(() => {
    if (!window.HQAuth) return Promise.resolve(null);
    return HQAuth.fetchProfile().then((p) => {
      setProfileState(p);
      setProfileLoaded(true);
      return p;
    });
  }, []);

  useEffect(() => {
    if (!session) {
      setProfileState(null);
      setProfileLoaded(false);
      return;
    }
    let alive = true;
    setProfileLoaded(false);
    HQAuth.fetchProfile().then((p) => {
      if (!alive) return;
      setProfileState(p);
      setProfileLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [session ? session.user.id : null]);

  const status =
    session === undefined
      ? "loading"
      : session === null
        ? "signedout"
        : !profileLoaded
          ? "loading"
          : !profile
            ? "bind"
            : !profile.setup_done
              ? "setup"
              : "ready";

  const signOut = useCallback(() => {
    if (window.HQAuth) HQAuth.signOut();
  }, []);

  return { status, session, profile, refreshProfile, signOut };
}

/* ============================================================
   AuthLoading — 驗證身分中
   ============================================================ */
const AuthLoading = () => (
  <div className="screen-body locked-screen">
    <div
      className="locked-card"
      style={{ textAlign: "center", padding: "48px 24px" }}
    >
      <div className="login-logo login-logo-center">
        <HQLogoMark size={56} />
      </div>
      <div className="locked-tag">HQ SITE LOG</div>
      <p className="locked-sub" style={{ marginTop: 12 }}>
        正在確認登入狀態…
      </p>
    </div>
  </div>
);

/* ============================================================
   LoginView — Google OAuth 或公司信箱密碼登入
   ============================================================ */
// 記住上次登入的公司信箱（僅存 email，絕不存密碼）。沿用專案 hq.* 命名慣例（同 hq.lastSite）。
const LAST_EMAIL_KEY = "hq.lastEmail";

// 登入頁品牌區塊：沿用 index.html splash 的 8 條 path 幾何（viewBox 120 120 783 628）
// 與線構成 / stroke 描繪語彙，改前綴 login-brand-* / lb* 避免與 splash 的 hqs* 撞名。
const LOGIN_BRAND_PATHS = [
  "M263.301 201L233.856 150H568.144L597.589 201H263.301Z",
  "M220 150H150L354.959 505H424.959L220 150Z",
  "M201 262.334L150 173.999V568H553.103L523.658 517H201V262.334Z",
  "M582 150L692.851 342H762.851L652 150H582Z",
  "M678.995 342H520.334L490.889 291H649.55L678.995 342Z",
  "M344.716 342L315.216 291H393.216L422.569 342H344.716Z",
  "M723.562 718L432 213H362L653.562 718H723.562Z",
  "M822 342V667H707.974L737.418 718H873V291H747.263L776.708 342H822Z",
];

const LoginBrandLogo = () => (
  <svg
    className="login-brand-logo"
    viewBox="120 120 783 628"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="HQ Design"
  >
    <defs>
      <linearGradient
        id="lbGrad"
        gradientUnits="userSpaceOnUse"
        x1="286"
        y1="824"
        x2="736"
        y2="44"
      >
        <stop offset="0" stopColor="#FFFFFF" />
        <stop offset="0.55" stopColor="#FDEDE5" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.55" />
      </linearGradient>
    </defs>
    {LOGIN_BRAND_PATHS.map((d, i) => (
      <path key={i} d={d} pathLength="1" style={{ "--i": i }} />
    ))}
  </svg>
);

// 背景巨型 HQ 浮水印（Figma 420:1917 右下 650px 大 logo）：純裝飾、緩慢浮動。
const LoginBrandWatermark = () => (
  <svg
    className="login-brand-watermark"
    viewBox="120 120 783 628"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {LOGIN_BRAND_PATHS.map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

// 內嵌樣式：登入頁專用，不落 app.css（與 splash 樣式隔離、隨元件掛載）。
//
// RWD 三層（皆以 container query 量 .login-brand-screen 的 inline-size，非 viewport，
// 因此桌面殼／手機柱兩種掛載環境都量得到真實可用寬度）：
//   base（< 600cqw）  手機直立：單欄、hero 置中、觸控目標 ≥ 44px、輸入框 16px（避免 iOS 對焦縮放）
//   ≥ 600cqw          平板／寬手機橫向：卡片與 hero 放大，仍單欄
//   ≥ 860cqw          桌面：hero 與卡片並排雙欄（860 而非 900，讓 Electron 最小視窗 900 穩定進雙欄）
//
// 另兩項與「手機版」直接相關的修正：
//   1. 捲動容器改 margin:auto 置中（原 justify-content:center 在內容高於容器時會裁掉上緣且捲不到）。
//   2. padding 併入 env(safe-area-inset-*)，避開 iPhone 劉海／Home indicator 與 Android 手勢列。
const LOGIN_BRAND_CSS = `
.login-brand-screen{position:absolute;inset:0;overflow:hidden;background:#D64518;container-type:inline-size;container-name:loginbrand}
.login-brand-bg{position:absolute;inset:0;background:linear-gradient(155deg,var(--vermillion-300,#ED6D45) 0%,#EE572F 36%,var(--vermillion-400,#D64518) 62%,var(--vermillion-600,#8E2A09) 100%)}
.login-brand-grain{position:absolute;inset:0;width:100%;height:100%;opacity:.08;mix-blend-mode:soft-light;pointer-events:none}
/* 常駐動畫層（Figma 420:1917）：只動 transform/opacity 走 GPU 合成，不逐幀 repaint。 */
.login-brand-glow{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;
  background:radial-gradient(58% 42% at 18% 12%,rgba(255,214,186,.32) 0%,rgba(255,158,110,.12) 46%,transparent 72%);
  animation:lbGlow 11s ease-in-out infinite alternate}
@keyframes lbGlow{from{opacity:.55;transform:translate3d(-2%,-1%,0) scale(1)}to{opacity:1;transform:translate3d(2%,2%,0) scale(1.06)}}
/* -7° 斜紋 vector（color-dodge、opacity .77）：三組不同週期的細紋疊出不等距節奏，
   位移量 276px 為三組週期（46/92/138）的公倍數，迴圈無縫。 */
.login-brand-stripes{position:absolute;inset:-24%;pointer-events:none;transform:rotate(-7deg);mix-blend-mode:color-dodge;opacity:.77;overflow:hidden}
.login-brand-stripes::before{content:"";position:absolute;inset:0;width:calc(100% + 276px);
  background:
    repeating-linear-gradient(90deg,rgba(255,255,255,.11) 0 2px,transparent 2px 46px),
    repeating-linear-gradient(90deg,rgba(255,255,255,.07) 0 7px,transparent 7px 92px),
    repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 138px);
  animation:lbStripeDrift 26s linear infinite}
@keyframes lbStripeDrift{to{transform:translate3d(-276px,0,0)}}
.login-brand-watermark{position:absolute;right:-9%;bottom:-13%;width:clamp(320px,62cqw,650px);height:auto;pointer-events:none;opacity:.07;animation:lbFloat 16s ease-in-out infinite alternate}
.login-brand-watermark path{fill:#fff}
@keyframes lbFloat{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-16px,0) rotate(-1.2deg)}}
.login-brand-pattern{position:absolute;inset:0;pointer-events:none;opacity:.9;
  background:
    repeating-linear-gradient(-60deg,rgba(255,255,255,.10) 0 1px,transparent 1px 22px),
    repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 64px),
    repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 1px,transparent 1px 96px);
  animation:lbPattern 1.2s cubic-bezier(.22,1,.36,1) both}
@keyframes lbPattern{0%{opacity:0;background-position:-90px 90px,-90px 90px,-90px 90px}100%{opacity:.9;background-position:0 0,0 0,0 0}}
.login-brand-scan{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;opacity:0;
  background:linear-gradient(60deg,transparent 44%,rgba(255,255,255,.5) 50%,transparent 56%);
  background-size:250% 250%;background-position:100% 100%;animation:lbScan 1s ease-out .5s both}
@keyframes lbScan{0%{opacity:0;background-position:100% 100%}25%{opacity:.8}100%{opacity:0;background-position:0% 0%}}
.login-brand-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;align-items:center;
  padding:
    max(clamp(24px,5cqw,56px),env(safe-area-inset-top))
    max(clamp(18px,5cqw,48px),env(safe-area-inset-right))
    max(clamp(24px,5cqw,56px),env(safe-area-inset-bottom))
    max(clamp(18px,5cqw,48px),env(safe-area-inset-left))}
/* margin:auto 垂直置中——內容高於容器時仍能捲到最頂（justify-content:center 會裁掉上緣）。 */
.login-brand-stack{margin:auto;display:flex;flex-direction:column;align-items:center;gap:clamp(20px,4cqw,36px);width:100%;max-width:440px}
.login-brand-inner{display:flex;flex-direction:column;align-items:center;gap:clamp(24px,4cqw,36px);width:100%}
.login-brand-hero{display:flex;flex-direction:column;align-items:center;text-align:center}
.login-brand-logo{display:block;width:clamp(88px,26cqw,132px);height:auto}
.login-brand-logo path{fill:#fff;fill-opacity:0;stroke:url(#lbGrad);stroke-width:2;stroke-linejoin:round;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:1;animation:lbDraw 1.2s cubic-bezier(.65,0,.35,1) calc(.2s + var(--i)*.08s) both,lbFill .5s ease-out calc(1.5s + var(--i)*.08s) both}
@keyframes lbDraw{to{stroke-dashoffset:0}}
@keyframes lbFill{to{fill-opacity:1;stroke-opacity:0}}
.login-brand-tag{color:rgba(255,255,255,.92);font:800 11px/1 Poppins,Geist,-apple-system,sans-serif;letter-spacing:.36em;text-indent:.36em;margin-top:18px}
.login-brand-title{color:#fff;font-size:clamp(19px,5.2cqw,24px);font-weight:700;margin-top:12px;letter-spacing:.01em;text-wrap:balance}
.login-brand-hero-sub{color:rgba(255,255,255,.8);font-size:12.5px;margin-top:8px;line-height:1.6;text-wrap:pretty}
.login-brand-company{color:rgba(255,255,255,.94);font-size:clamp(13px,3.6cqw,15px);font-weight:600;letter-spacing:.14em;margin-top:10px;animation:lbRise .8s cubic-bezier(.22,1,.36,1) .8s both}
.login-brand-stats{display:flex;align-items:center;gap:clamp(16px,4cqw,28px);margin-top:20px;animation:lbRise .8s cubic-bezier(.22,1,.36,1) 1s both}
.login-brand-stat{display:flex;flex-direction:column;align-items:center;gap:5px}
.login-brand-stat b{color:#fff;font:700 clamp(22px,6cqw,28px)/1 Poppins,Geist,-apple-system,sans-serif;letter-spacing:.01em}
.login-brand-stat b i{font-style:normal;font-size:.5em;margin-left:3px;opacity:.85;letter-spacing:.06em}
.login-brand-stat span{color:rgba(255,255,255,.72);font-size:10.5px;letter-spacing:.18em;text-indent:.18em}
.login-brand-stats-divider{width:1px;height:36px;background:rgba(255,255,255,.3)}
@keyframes lbRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.login-brand-card{width:100%;background:#fff;border-radius:20px;padding:clamp(20px,5cqw,32px);box-shadow:0 24px 60px -20px rgba(58,16,4,.5),0 4px 14px -6px rgba(58,16,4,.28);animation:lbRise .8s cubic-bezier(.22,1,.36,1) .35s both}
.login-brand-card-title{margin:0;font-size:20px;font-weight:700;color:var(--fg1,#1c1917)}
.login-brand-card-sub{margin:6px 0 20px;font-size:13px;line-height:1.6;color:var(--fg3,#78716c)}
.login-brand-foot{color:rgba(255,255,255,.82);font-size:11.5px;line-height:1.7;text-align:center;max-width:420px}
.login-brand-foot strong{color:#fff;font-weight:600;letter-spacing:.06em}

/* 手機觸控目標：卡片內控件拉到 ≥44px（.locked-* 基準值是 37–42px，指觸偏小）；
   輸入字級 16px 讓 iOS Safari 對焦時不自動放大頁面。僅作用於登入卡內，不動綁定／初設頁。 */
.login-brand-card .google-btn{min-height:46px;padding:11px 14px;font-size:14px}
.login-brand-card .locked-input-wrap{min-height:46px;padding:8px 12px}
.login-brand-card .locked-input-wrap input{font-size:16px}
.login-brand-card .locked-clear{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px}
.login-brand-card .locked-act{height:48px;font-size:15px}
.login-brand-card .locked-hint-row{min-height:32px}

/* ≥600：平板／寬手機橫向，仍單欄但放寬卡片與 hero。 */
@container loginbrand (min-width:600px){
  .login-brand-stack{max-width:460px}
  .login-brand-logo{width:132px}
  .login-brand-title{font-size:26px}
  .login-brand-hero-sub{font-size:13px}
  .login-brand-card .locked-input-wrap input{font-size:14px}
}

/* ≥860：桌面雙欄（hero 靠左、登入卡靠右）。 */
@container loginbrand (min-width:860px){
  .login-brand-stack{max-width:900px}
  .login-brand-inner{flex-direction:row;align-items:center;gap:clamp(40px,6cqw,80px)}
  .login-brand-hero{flex:1;align-items:flex-start;text-align:left}
  .login-brand-logo{width:clamp(120px,14cqw,168px)}
  .login-brand-title{font-size:clamp(24px,2.6cqw,32px)}
  .login-brand-hero-sub{font-size:14px;max-width:38ch}
  .login-brand-company{font-size:17px}
  .login-brand-stats{gap:32px;margin-top:26px}
  .login-brand-stat{align-items:flex-start}
  .login-brand-stat b{font-size:32px}
  .login-brand-stat span{text-indent:0}
  .login-brand-card{flex:0 0 400px;max-width:400px}
  .login-brand-foot{max-width:640px}
}

/* 矮視窗（手機橫向 / 小筆電）：壓縮品牌區，優先保住表單可見。 */
@media(max-height:600px){
  .login-brand-logo{width:72px}
  .login-brand-tag{margin-top:12px}
  .login-brand-title{margin-top:8px;font-size:18px}
  .login-brand-hero-sub{display:none}
  .login-brand-stats{display:none}
  .login-brand-company{margin-top:6px;font-size:12px}
  .login-brand-stack{gap:16px}
  .login-brand-inner{gap:16px}
}
@media(prefers-reduced-motion:reduce){
  .login-brand-pattern,.login-brand-logo path,.login-brand-scan,
  .login-brand-glow,.login-brand-stripes::before,.login-brand-watermark,
  .login-brand-company,.login-brand-stats,.login-brand-card{animation:none}
  .login-brand-pattern{opacity:.9;background-position:0 0,0 0,0 0}
  .login-brand-logo path{stroke-dashoffset:0;fill-opacity:1;stroke-opacity:0}
  .login-brand-scan{display:none}
}
`;

function LoginView() {
  // 開啟登入頁時自動預填上次成功登入的 email（若有）。
  const [account, setAccount] = useState(() => {
    try {
      return localStorage.getItem(LAST_EMAIL_KEY) || "";
    } catch (e) {
      return "";
    }
  });
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    const email = account.trim().toLowerCase();
    if (!email) {
      setErr("請輸入公司信箱");
      return;
    }
    if (!email.endsWith("@hqdesign.tw")) {
      setErr("請使用 @hqdesign.tw 公司信箱");
      return;
    }
    if (!window.HQAuth) {
      setErr("連線失敗，請檢查網路後重試");
      return;
    }
    setBusy(true);
    setErr("");
    const { error } = await HQAuth.signIn(email, pwd);
    setBusy(false);
    if (error) {
      setErr("帳號或密碼錯誤，請重新輸入");
      return;
    }
    // 登入成功：記住 email 供下次預填（僅 email，不含密碼）。
    try {
      localStorage.setItem(LAST_EMAIL_KEY, email);
    } catch (e) {}
    // 成功時 onAuthStateChange 會自動切換畫面
  };

  const onOAuth = async (p) => {
    if (!window.HQAuth) {
      setErr("連線失敗，請檢查網路後重試");
      return;
    }
    setErr("");
    const { error } = await HQAuth.signInWithOAuth(p.id);
    if (error) setErr(p.name + " 登入尚未啟用，請改用公司信箱登入");
  };

  return (
    <div className="screen-body login-brand-screen">
      <style>{LOGIN_BRAND_CSS}</style>
      <div className="login-brand-bg" />
      <svg
        className="login-brand-grain"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <filter id="lbNoise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#lbNoise)" />
      </svg>
      <div className="login-brand-glow" />
      <div className="login-brand-pattern" />
      <div className="login-brand-stripes" />
      <LoginBrandWatermark />
      <div className="login-brand-scan" />

      <div className="login-brand-scroll">
        {/* stack：hero+卡片+footer 一起 margin:auto 置中，內容超高時可完整捲動 */}
        <div className="login-brand-stack">
          <div className="login-brand-inner">
            <div className="login-brand-hero">
              <LoginBrandLogo />
              <div className="login-brand-tag">HQ SITE LOG</div>
              <div className="login-brand-title">工地簽到與人員管理系統</div>
              <div className="login-brand-company">
                惠強室內裝修股份有限公司
              </div>
              <div className="login-brand-stats">
                <div className="login-brand-stat">
                  <b>1,600+</b>
                  <span>累積完工案件</span>
                </div>
                <div className="login-brand-stats-divider" />
                <div className="login-brand-stat">
                  <b>
                    30<i>YRS</i>
                  </b>
                  <span>產業深耕年資</span>
                </div>
              </div>
            </div>

            <div className="login-brand-card">
              <h2 className="login-brand-card-title">登入</h2>
              <p className="login-brand-card-sub">
                請使用 Google 帳號登入，或輸入公司信箱與密碼。
              </p>

              <form className="locked-form" onSubmit={submit}>
                {OAUTH_PROVIDERS.filter((p) => p.enabled).map((p) => {
                  const Logo = p.Logo;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="google-btn"
                      onClick={() => onOAuth(p)}
                    >
                      <Logo /> {p.label}
                    </button>
                  );
                })}

                <div className="locked-or">
                  <span>或使用公司信箱</span>
                </div>

                <div
                  className={`locked-input-wrap ${err && !account.trim() ? "err" : ""}`}
                >
                  <Icon name="user" size={16} color="var(--fg3)" />
                  <input
                    ref={inputRef}
                    type="email"
                    placeholder="公司信箱（name@hqdesign.tw）"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    autoComplete="username"
                    inputMode="email"
                  />
                  {account.length > 0 && (
                    <button
                      type="button"
                      className="locked-clear"
                      onClick={() => setAccount("")}
                      aria-label="清除"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>

                <div
                  className={`locked-input-wrap ${err && account.trim() ? "err" : ""}`}
                >
                  <Icon name="shield-check" size={16} color="var(--fg3)" />
                  <input
                    type="password"
                    placeholder="密碼（初次登入使用管理員提供的一次性密碼）"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    autoComplete="current-password"
                  />
                  {pwd.length > 0 && (
                    <button
                      type="button"
                      className="locked-clear"
                      onClick={() => setPwd("")}
                      aria-label="清除"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>

                {err && (
                  <div className="locked-error">
                    <Icon name="alert-circle" size={13} /> {err}
                  </div>
                )}

                <div className="locked-actions locked-actions-single">
                  <button
                    type="submit"
                    className="locked-act unlock"
                    disabled={busy || !account.trim() || !pwd}
                  >
                    <span>{busy ? "登入中…" : "登入"}</span>
                    <Icon name="log-in" size={16} strokeWidth={1.8} />
                  </button>
                </div>
              </form>

              <div className="locked-hint-row">
                <span className="locked-hint-btn" style={{ cursor: "default" }}>
                  <Icon name="info" size={12} /> 帳號由 IT
                  管理員建立，初次登入後須變更密碼
                </span>
              </div>
            </div>
          </div>

          <div className="login-brand-foot">
            <strong>SECURITY · 安全提醒</strong>
            <br />
            僅限 HQ 惠強室內裝修同仁使用。若無法登入，請聯絡 IT 管理員重設密碼。
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BindCompanyView — Google 登入後綁定 @hqdesign.tw 公司信箱
   ============================================================ */
function BindCompanyView({ auth }) {
  // 偵測目前 session 是用哪個 provider 登入（Google / Notion …），
  // 後端以同一個 bind-provider action 處理，前端只需帶上 provider id。
  const oauthUser = auth.session?.user;
  const providerId =
    oauthUser?.app_metadata?.provider ||
    oauthUser?.app_metadata?.providers?.[0] ||
    "google";
  const providerCfg = OAUTH_PROVIDERS.find((p) => p.id === providerId);
  const providerName = providerCfg?.name || providerId;
  const oauthEmail = oauthUser?.email || "";
  // 自動帶入第三方 email 的使用者名稱，補上公司網域（Notion 可能無 email，留空手動輸入）
  const [email, setEmail] = useState(() => {
    const user = oauthEmail.split("@")[0] || "";
    return user ? user.toLowerCase() + "@hqdesign.tw" : "";
  });
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    const em = email.trim().toLowerCase();
    if (!em.endsWith("@hqdesign.tw")) {
      setErr("請輸入 @hqdesign.tw 公司信箱");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await HQAuth.invoke({
      action: "bind-provider",
      provider: providerId,
      company_email: em,
      company_password: pwd,
    });
    if (res.error) {
      setBusy(false);
      setErr(res.error);
      return;
    }
    await auth.refreshProfile();
    setBusy(false);
  };

  return (
    <div className="screen-body locked-screen">
      <div className="locked-card">
        <div className="locked-tag">STEP 2 · 綁定公司信箱</div>
        <h2 className="locked-title">綁定公司帳號</h2>
        <p className="locked-sub">
          已使用 {providerName} 帳號{oauthEmail ? ` ${oauthEmail}` : ""} 登入
        </p>
        <p className="locked-instr">
          首次使用需綁定 @hqdesign.tw 公司信箱，驗證後即完成連結。
        </p>

        <form className="locked-form" onSubmit={submit}>
          <div className={`locked-input-wrap ${err ? "err" : ""}`}>
            <Icon name="user" size={16} color="var(--fg3)" />
            <input
              type="email"
              placeholder="公司信箱（name@hqdesign.tw）"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              inputMode="email"
            />
          </div>
          <div className={`locked-input-wrap ${err ? "err" : ""}`}>
            <Icon name="shield-check" size={16} color="var(--fg3)" />
            <input
              type="password"
              placeholder="密碼（初次登入使用管理員提供的一次性密碼）"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="locked-error">
              <Icon name="alert-circle" size={13} /> {err}
            </div>
          )}

          <div className="locked-actions">
            <button
              type="button"
              className="locked-act back"
              onClick={auth.signOut}
              aria-label="改用公司帳號登入"
            >
              <Icon name="arrow-left" size={16} strokeWidth={1.8} />
              <span>改用公司帳號</span>
            </button>
            <button
              type="submit"
              className="locked-act unlock"
              disabled={busy || !email.trim() || !pwd}
            >
              <span>{busy ? "驗證中…" : "綁定"}</span>
              <Icon name="check" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </form>

        <div className="locked-hint-row">
          <span className="locked-hint-btn" style={{ cursor: "default" }}>
            <Icon name="info" size={12} /> 尚未有公司帳號？請聯絡 IT 管理員建立
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FirstSetupView — 首次登入：填寫姓名（英文為主）並變更預設密碼
   ============================================================ */
function FirstSetupView({ auth }) {
  const [name, setName] = useState(auth.profile?.name || "");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!name.trim()) {
      setErr("請輸入姓名（英文為主）");
      return;
    }
    if (pwd.length < 6) {
      setErr("新密碼至少 6 碼");
      return;
    }
    if (pwd !== pwd2) {
      setErr("兩次輸入的密碼不一致");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await HQAuth.invoke({
      action: "self-setup",
      name: name.trim(),
      password: pwd,
    });
    if (res.error) {
      setBusy(false);
      setErr(res.error);
      return;
    }
    // 改密碼會撤銷舊 session，須以新密碼重新登入
    const email = auth.profile?.email || auth.session?.user?.email;
    if (email) await HQAuth.signIn(email, pwd);
    await auth.refreshProfile();
    setBusy(false);
  };

  return (
    <div className="screen-body locked-screen">
      <div className="locked-card">
        <div className="locked-tag">FIRST SIGN-IN · 基本資料</div>
        <h2 className="locked-title">完成帳號設定</h2>
        <p className="locked-sub">{auth.profile?.email}</p>
        <p className="locked-instr">
          請填寫姓名（英文為主）並設定新密碼。其他欄位（部門、職位、負責專案）由管理員或主管授予。
        </p>

        <form className="locked-form" onSubmit={submit}>
          <div className="locked-input-wrap">
            <Icon name="user" size={16} color="var(--fg3)" />
            <input
              type="text"
              placeholder="姓名（例：Christian Wu）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="locked-input-wrap">
            <Icon name="shield-check" size={16} color="var(--fg3)" />
            <input
              type="password"
              placeholder="新密碼（至少 6 碼）"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div
            className={`locked-input-wrap ${pwd2 && pwd !== pwd2 ? "err" : ""}`}
          >
            <Icon name="shield-check" size={16} color="var(--fg3)" />
            <input
              type="password"
              placeholder="確認新密碼"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {err && (
            <div className="locked-error">
              <Icon name="alert-circle" size={13} /> {err}
            </div>
          )}

          <div className="locked-actions">
            <button
              type="button"
              className="locked-act back"
              onClick={auth.signOut}
              aria-label="登出"
            >
              <Icon name="arrow-left" size={16} strokeWidth={1.8} />
              <span>登出</span>
            </button>
            <button
              type="submit"
              className="locked-act unlock"
              disabled={busy || !name.trim() || !pwd || !pwd2}
            >
              <span>{busy ? "儲存中…" : "完成"}</span>
              <Icon name="check" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

Object.assign(window, {
  useAuth,
  AuthLoading,
  LoginView,
  BindCompanyView,
  FirstSetupView,
});
