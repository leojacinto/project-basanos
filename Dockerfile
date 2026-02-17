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

# Build TypeScript
RUN npm run build

# Expose dashboard port and mock ServiceNow port
EXPOSE 3001 8090

# Default: run the demo (mock server + dashboard)
CMD ["sh", "-c", "node dist/mock/servicenow-server.js & sleep 1 && node dist/dashboard.js"]
