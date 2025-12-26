# Use Node.js LTS (Long Term Support) version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
# Using npm ci for cleaner/faster install if lockfile exists, else npm install
RUN npm install

# Copy configuration files needed for build
COPY vite.config.js ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY eslint.config.js ./

# Copy source code
COPY . .

# Build the UI
# This runs "vite build" per package.json, which uses root: 'ui' and outputs to 'dist'
RUN npm run build

# Expose the port the app runs on
EXPOSE 3001

# Start the application
CMD ["npm", "run", "server"]
