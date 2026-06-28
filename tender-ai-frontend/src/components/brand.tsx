// 品牌標記：HQdesign 官方 logo（橙底 #D64518 圓角方塊＋白色 HQ monogram）。
// 內聯 SVG（來源：HQ-logo.svg），可隨 size 縮放、雙主題皆適用；保留 size API
// 供 sidebar / topbar / login 三處共用，換 logo 只需改此一處。
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="1024" height="1024" rx="100" fill="#D64518" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M678.995 420H520.335L490.89 369H649.55L678.995 420Z"
        fill="white"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M822 420V745H707.974L737.419 796H873V369H747.263L776.708 420H822Z"
        fill="white"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M263.301 279L233.856 228H568.144L597.589 279H263.301Z"
        fill="white"
      />
      <path d="M582 228L692.851 420H762.851L652 228H582Z" fill="white" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M201 340.334L150 251.999V646H553.103L523.658 595H201V340.334Z"
        fill="white"
      />
      <path d="M220 228H150L354.959 583H424.959L220 228Z" fill="white" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M723.562 796L432 291H362L653.562 796H723.562Z"
        fill="white"
      />
      <path
        d="M344.716 420L315.216 369H393.216L422.569 420H344.716Z"
        fill="white"
      />
    </svg>
  );
}
