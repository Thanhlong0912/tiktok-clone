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
      /**
       * Tailwind's default opacity scale jumps 10 → 20 → 25 → 30 → 40 → 50, so
       * `bg-black/45`, `bg-black/55` and friends generated NO rule at all and
       * the overlay chrome that asked for them -- the sound pill, the options
       * button, the mobile action rail, toasts, the bottom nav -- rendered with
       * a fully transparent background over the video.
       *
       * Purely additive: every value here is one Tailwind does not emit today,
       * so no existing rule changes. It only makes the classes already written
       * across the app do what they say.
       */
      opacity: {
        15: '0.15',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
      },
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
