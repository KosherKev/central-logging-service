# Use Node.js LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files + scoped registry config (no token in the image layers)
COPY package*.json ./
COPY .npmrc ./

# Install production deps. Token is a BuildKit secret — never ARG/ENV (leaks into layers).
# Build with: DOCKER_BUILDKIT=1 docker build --secret id=npm_token,src=.secrets/npm_token ...
RUN --mount=type=secret,id=npm_token \
    echo "@bevingh:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    npm ci --only=production && \
    rm .npmrc

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/server.js"]
