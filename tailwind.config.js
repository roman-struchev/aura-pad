/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        fleet: {
          bg: 'var(--fleet-bg)',
          sidebar: 'var(--fleet-sidebar)',
          border: 'var(--fleet-border)',
          text: 'var(--fleet-text)',
          textHover: 'var(--fleet-textHover)',
          active: 'var(--fleet-active)',
          header: 'var(--fleet-header)'
        }
      }
    }
  },
  plugins: []
}
