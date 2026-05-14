/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 胡桃配色
        hutao: {
          red:   '#a8242a',
          gold:  '#c8a866',
          dark:  '#2a1c1c',
        },
        // TiaLynn 灵魂色
        tia: {
          pink:    '#f9a8d4',
          deep:    '#7c3aed',
          neutral: '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Noto Sans CJK SC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
