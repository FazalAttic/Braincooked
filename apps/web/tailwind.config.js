/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#0A0907',
        cream: '#FFE9B4',
        cardBg: '#181612',
        cardBorder: '#2E2B25',
        textMuted: '#9B968C',
        textMain: '#FCFFFA',
        stage: {
          fresh: '#79D056',
          warming: '#FFE9B4',
          tired: '#FFB367',
          drained: '#FC4A52',
          rot: '#9B51E0',
        },
        platform: {
          yt: '#FF6B66',
          ig: '#E1306C',
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

