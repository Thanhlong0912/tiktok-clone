import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        xs: '480px',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        // Legacy tokens (kept for existing components)
        dark: '#121212',
        medium: '#1c1c22',
        // Brand
        tiktok: {
          DEFAULT: '#fe2c55',
          hover: '#ef2950',
          cyan: '#25f4ee',
        },
        // Semantic surface tokens (theme-aware via CSS variables)
        surface: {
          DEFAULT: 'var(--tt-bg)',
          elevated: 'var(--tt-bg-elevated)',
          subtle: 'var(--tt-bg-subtle)',
        },
        line: 'var(--tt-border)',
        ink: {
          DEFAULT: 'var(--tt-text)',
          soft: 'var(--tt-text-secondary)',
        },
      },
      boxShadow: {
        rail: '0 4px 24px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
}
export default config
