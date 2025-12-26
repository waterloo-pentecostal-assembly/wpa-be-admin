/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./ui/index.html",
        "./ui/src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: '#0191d7',
                    50: '#f0f9ff',
                    100: '#e0f2fe',
                    200: '#bae6fd',
                    300: '#7dd3fc',
                    400: '#38bdf8',
                    500: '#0191d7', // The requested color (approximate match to sky-500/600 range but custom)
                    600: '#0284c7', // Darker for hover
                    700: '#0369a1',
                }
            }
        },
    },
    plugins: [],
}
