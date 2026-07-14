import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          400: '#4ea3ff',
          500: '#2f7df7',
          600: '#1f63d3',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
