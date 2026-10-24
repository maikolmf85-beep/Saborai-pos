/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        main: '#fcfeff',
        primary: '#3b3733',
        accent: '#a9b994',
        neutral: '#6b686d',
        sage: {
          50: '#f4f6f0',
          100: '#e8ecdf',
          200: '#d3dbc3',
          300: '#b8c6a0',
          400: '#a9b994',
          500: '#8fa278',
          600: '#728560',
          700: '#5a694c',
          800: '#4a5640',
          900: '#3f4937',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
        heading: ['Plus Jakarta Sans', 'sans-serif'],
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.primary'),
            a: {
              color: theme('colors.sage.600'),
              '&:hover': {
                color: theme('colors.sage.800'),
              },
            },
            'h1, h2, h3, h4': {
              fontFamily: theme('fontFamily.heading').join(', '),
              color: theme('colors.primary'),
            },
            code: {
              color: theme('colors.sage.800'),
              backgroundColor: theme('colors.sage.50'),
              borderRadius: '0.375rem',
              padding: '0.125rem 0.375rem',
            },
            blockquote: {
              borderLeftColor: theme('colors.accent'),
            },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
