/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        /* Canvas + surfaces */
        obsidian: '#060705',
        charcoal: '#11150E',
        elevated: '#181E13',
        /* Accent */
        lime: {
          DEFAULT: '#A8EB34',
          end: '#78C214',
          glow: '#4A6B1D',
        },
        hairline: '#2C381E',
        /* Text */
        ink: {
          white: '#FFFFFF',
          sage: '#9BA394',
          inverse: '#080A06',
        },
      },
      fontFamily: {
        display: ['PlusJakartaSans_800ExtraBold', 'Inter_900Black', 'sans-serif'],
        heading: ['PlusJakartaSans_700Bold', 'Inter_700Bold', 'sans-serif'],
        body: ['PlusJakartaSans_500Medium', 'Inter_500Medium', 'sans-serif'],
      },
      borderRadius: {
        bento: '28px',
        pill: '999px',
      },
      spacing: {
        gutter: '20px',
      },
    },
  },
  plugins: [],
};
