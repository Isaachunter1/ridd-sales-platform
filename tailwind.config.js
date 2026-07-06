module.exports = {
  content: ['/sessions/awesome-tender-albattani/mnt/ridd-sales-platform/index.html'],
  safelist: [
    'max-w-[min(360px,calc(100vw-2rem))]',   // toast width — extractor chokes on the nested comma
  ],
  theme: {
    extend: {
      colors: {
        smoke: '#F3F3F3', smoke2: '#FAFAFA', eerie: '#1D1D1D', eerie2: '#262626', eerie3: '#2f2f2f',
        lime: '#8DC63F', 'lime-600': '#7bb132', 'lime-400': '#a4d558', 'lime-50': '#F1F8E6',
        battleship: '#757667', 'battle-2': '#8e8f80',
      },
      fontFamily: { sans: ['Inter','ui-sans-serif','system-ui','-apple-system','Segoe UI','Roboto','sans-serif'] },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
