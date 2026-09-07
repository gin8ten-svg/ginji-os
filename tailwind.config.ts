import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          200: '#b7dbff',
          300: '#8ec2ff',
          400: '#4ea3ff',
          500: '#2f7df7',
          600: '#1f63d3',
          700: '#1a4fa8',
          800: '#173f85',
          900: '#152f66',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
