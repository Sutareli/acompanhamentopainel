/** @type {import('tailwindcss').Config} */
// Paleta: cinzas frios + um índigo contido (marca) só em ação/seleção. Os tons `violet` foram redefinidos para índigo-acinzentado,
// então todo o painel herda a mesma paleta sem trocar classe por classe.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      navy: '#26294f', turq: '#4f46b5', ink: '#1d2230', papel: '#f4f5f8', linha: '#dfe2e9',
      violet: { 50: '#f5f6fa', 100: '#eceef5', 200: '#dde0ec', 300: '#c5c9dc', 400: '#9ea4c2', 500: '#7c83a8', 600: '#5f6690', 700: '#4a5078', 800: '#363b5c', 900: '#272b45' },
    },
    fontFamily: { sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
  } },
  plugins: [],
}
