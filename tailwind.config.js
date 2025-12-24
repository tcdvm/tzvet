module.exports = {
  content: [
    './src/**/*.{html,js}',
    './src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {}
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: ['light']
  }
};