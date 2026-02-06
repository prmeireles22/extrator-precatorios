# Stage 1: Build
FROM node:20-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.4.1

# Copy dependency files and patches
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install all dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the application
# Frontend -> dist/public
# Backend -> dist/index.js
RUN pnpm run build

# Stage 2: Runtime
FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.4.1

# Set production environment
ENV NODE_ENV=production

# Copy only what's needed for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/patches ./patches

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Default Cloud Run port
ENV PORT=8080
EXPOSE 8080

# The start script in package.json handles NODE_ENV=production node dist/index.js
CMD ["pnpm", "start"]
