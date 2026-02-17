FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY domains/ ./domains/
COPY discovery-rules.yaml ./
COPY .env.example ./

# Build TypeScript
RUN npm run build

# Persist constraint overrides across container restarts
VOLUME ["/app/constraint-overrides.json"]

# Expose dashboard port and mock ServiceNow port
EXPOSE 3001 8090

# Support .env file mounted at runtime:
#   docker run -v $(pwd)/.env:/app/.env ...
# Or pass env vars directly:
#   docker run -e SERVICENOW_MCP_SERVER_URL=... -e SERVICENOW_CLIENT_ID=... ...

# Default: run the demo (mock server + dashboard)
CMD ["sh", "-c", "node dist/mock/servicenow-server.js & sleep 1 && node dist/dashboard.js"]
