#!/bin/bash

echo "🃏 Basanos Demo (Mock ServiceNow)"
echo "=================================="
echo ""

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the project root"
    exit 1
fi

# ── Port check (Virgil pattern) ──────────────────────────────

check_and_kill_port() {
    local port=$1
    local service=$2
    local pids=$(lsof -ti:$port 2>/dev/null)

    if [ ! -z "$pids" ]; then
        echo "⚠️  Found existing process(es) on port $port ($service)"
        echo "   PIDs: $pids"
        read -p "   Kill these processes? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "$pids" | xargs kill -9 2>/dev/null
            echo "   Done"
            sleep 1
        else
            echo "   ❌ Cannot start $service - port $port is in use"
            exit 1
        fi
    fi
}

echo "🔍 Checking for existing processes..."
check_and_kill_port 8090 "Mock ServiceNow"
check_and_kill_port 3001 "Dashboard"
echo ""

# ── Cleanup on exit ──────────────────────────────────────────

cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $MOCK_PID $DASHBOARD_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# ── Build ────────────────────────────────────────────────────

echo "🔨 Building..."
npm run build --silent
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "   Done"
echo ""

# ── Step 1: Mock ServiceNow server ──────────────────────────

echo "📡 Starting Mock ServiceNow server..."
node dist/mock/servicenow-server.js &
MOCK_PID=$!

# Wait for mock to be ready
RETRY=0
until curl -s http://localhost:8090/api/now/table/incident -u admin:admin > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge 15 ]; then
        echo "   ⚠️  Mock server health check timed out"
        break
    fi
    sleep 1
done

if curl -s http://localhost:8090/api/now/table/incident -u admin:admin > /dev/null 2>&1; then
    echo "   ✅ Mock ServiceNow running on http://localhost:8090"
else
    echo "   Proceeding anyway..."
fi
echo ""

# ── Step 2: Run the full pipeline ────────────────────────────

echo "🔄 Running import pipeline (connect > import > sync > discover)..."
echo "────────────────────────────────────────────────────────────"
node dist/cli.js full
echo "────────────────────────────────────────────────────────────"
echo ""

# ── Step 3: Launch dashboard ─────────────────────────────────

echo "🎨 Starting Dashboard..."
node dist/dashboard.js &
DASHBOARD_PID=$!

sleep 2

echo ""
echo "✅ Basanos demo is running!"
echo ""
echo "📍 Mock ServiceNow: http://localhost:8090"
echo "📍 Dashboard:       http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop everything"
echo ""

wait
