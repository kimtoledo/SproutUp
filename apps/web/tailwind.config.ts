import type { Config } from 'tailwindcss';

/**
 * SproutUp design tokens.
 *
 * Values are intentionally matched to the palette the hand-rolled CSS in
 * `app/globals.css` already used, so activating Tailwind utilities does not
 * change the look of screens that have not been migrated yet. New feature UI is
 * built from the component kit in `components/ui/` using these tokens; legacy
 * `.class` selectors in `globals.css` are removed as each route migrates.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy aliases kept until every route is migrated off globals.css.
        ink: '#14231a',
        leaf: '#287a4b',
        mist: '#edf5ef',
        sun: '#e9b949',

        // Semantic tokens.
        canvas: '#f7faf7',
        surface: '#ffffff',
        'surface-muted': '#f4f8f5',
        border: '#dce5de',
        'border-strong': '#cbd8cd',
        foreground: '#14231a',
        'muted-foreground': '#5c6f62',
        primary: '#287a4b',
        'primary-hover': '#20623c',
        'primary-foreground': '#ffffff',
        ring: '#e9b949',
        danger: '#8b3834',
        'danger-foreground': '#ffffff',
        'danger-subtle': '#f8e7e5',
        'danger-strong': '#7c3431',
        warning: '#8a6d1f',
        'warning-subtle': '#fff3cd',
        'warning-strong': '#5b4a1f',
        success: '#1d6a3c',
        'success-subtle': '#e1f2e7',
        'info-subtle': '#e7f0fb',
        'info-strong': '#1f4a72',
      },
      borderRadius: {
        DEFAULT: '10px',
        sm: '6px',
        md: '12px',
        lg: '16px',
        xl: '22px',
        '2xl': '28px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 35, 26, 0.04), 0 8px 24px rgba(31, 74, 46, 0.06)',
        panel: '0 24px 70px rgba(31, 74, 46, 0.10)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
      },
      maxWidth: {
        content: '1120px',
        'content-wide': '1220px',
      },
    },
  },
  plugins: [],
};

export default config;
