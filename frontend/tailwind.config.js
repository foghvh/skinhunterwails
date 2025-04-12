module.exports = {
  content: ['./src/**/*.{html,js,jsx}'], // Archivos que contienen clases Tailwind
  theme: {
    extend: {
          colors: {


      "primary": "#1e1e1e",
      "secondary": "#0d0d0d"
      

    },
    fontFamily: {

      'body': ['Poppins']

    }
    },

    corePlugins: {
      aspectRatio: false,
    },
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'),

  ],
};