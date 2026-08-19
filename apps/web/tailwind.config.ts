import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14231a',
        leaf: '#287a4b',
        mist: '#edf5ef',
        sun: '#e9b949',
      },
    },
  },
  plugins: [],
};

export default config;
