#!/bin/bash

echo "🃏 Basanos (Live ServiceNow)"
echo "============================="
echo ""

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the project root"
    exit 1
fi

# ── Check .env ───────────────────────────────────────────────

if [ ! -f ".env" ]; then
    echo "❌ No .env file found."
    echo "   Copy .env.example to .env and configure your ServiceNow credentials."
    echo "   cp .env.example .env"
    exit 1
fi

if ! grep -q "SERVICENOW_INSTANCE_URL" .env; then
    echo "❌ .env is missing SERVICENOW_INSTANCE_URL"
    exit 1
fi

echo "📋 Using credentials from .env"
echo ""

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
check_and_kill_port 3001 "Dashboard"
echo ""

# ── Cleanup on exit ──────────────────────────────────────────

cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $DASHBOARD_PID 2>/dev/null
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

# ── Step 1: Run the full pipeline ────────────────────────────

echo "🔄 Running import pipeline (connect > import > sync > discover)..."
echo "────────────────────────────────────────────────────────────"
node dist/cli.js full
CLI_EXIT=$?
echo "────────────────────────────────────────────────────────────"
echo ""

if [ $CLI_EXIT -ne 0 ]; then
    echo "❌ Pipeline failed. Check your .env credentials."
    exit 1
fi

# ── Step 2: Launch dashboard ─────────────────────────────────

echo "🎨 Starting Dashboard..."
node dist/dashboard.js &
DASHBOARD_PID=$!

sleep 2

echo ""
echo "✅ Basanos is running!"
echo ""
echo "📍 Dashboard: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop"
echo ""

wait
