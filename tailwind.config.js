/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fleet: {
          bg: '#181818',
          sidebar: '#1E1E1E',
          border: '#323232',
          text: '#CCCCCC',
          textHover: '#FFFFFF',
          active: '#2D2D2D',
          header: '#252525'
        }
      }
    },
  },
  plugins: [],
}