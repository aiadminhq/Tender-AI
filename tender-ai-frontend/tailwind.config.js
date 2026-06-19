/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      screens: {
        sm: "640px", // mobile-tablet boundary
        md: "810px", // tablet-desktop boundary (custom)
        lg: "1200px", // desktop (custom)
        xl: "1400px", // large desktop
      },
    },
  },
  plugins: [],
};
