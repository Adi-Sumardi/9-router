#!/usr/bin/env bash

# Test script untuk 9Router Gateway
ROUTER_URL="http://127.0.0.1:20128/v1"

# 1. Ambil API Key dari argumen, atau .env, atau database lokal
API_KEY="$1"

if [ -z "$API_KEY" ] && [ -f .env ]; then
  API_KEY=$(grep -E "^ROUTER_API_KEY=" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'" | tr -d ' ')
fi

if [ -z "$API_KEY" ] && [ -f ./data/db/data.sqlite ]; then
  API_KEY=$(sqlite3 ./data/db/data.sqlite "SELECT key FROM apiKeys WHERE isActive = 1 LIMIT 1;" 2>/dev/null)
fi

if [ -z "$API_KEY" ]; then
  echo "⚠️  Penggunaan: ./test_gateway.sh <API_KEY_9ROUTER>"
  echo "   atau export ROUTER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx"
  exit 1
fi

echo "=========================================="
echo "🔑 Menggunakan Gateway Key: ${API_KEY:0:8}..."
echo "=========================================="
echo "🔍 1. Memeriksa Daftar Model di 9Router..."
echo "=========================================="

MODELS_JSON=$(curl -s -w "\n%{http_code}" "$ROUTER_URL/models" \
  -H "Authorization: Bearer $API_KEY")

HTTP_CODE=$(echo "$MODELS_JSON" | tail -n1)
BODY=$(echo "$MODELS_JSON" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Gagal mengambil model (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi

TOTAL_MODELS=$(echo "$BODY" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')
echo "✅ Berhasil! Terdeteksi $TOTAL_MODELS model terdaftar."
echo "📋 Contoh 5 model pertama:"
echo "$BODY" | grep -o '"id":"[^"]*"' | head -n 5 | cut -d':' -f2 | tr -d '"' | sed 's/^/   - /'
echo ""

# Model target untuk test (bisa dispesifikasikan di argumen ke-2)
TEST_MODEL="${2:-claude-virtually-unlimited}"

echo "=========================================="
echo "💬 2. Mengirim Prompt Uji ke Model: $TEST_MODEL"
echo "=========================================="

RESPONSE=$(curl -s -N -X POST "$ROUTER_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"model\": \"$TEST_MODEL\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Halo! Sebutkan nama modelmu dan buatkan fungsi JavaScript singkat untuk reverse string.\"}
    ],
    \"stream\": true
  }")

echo "$RESPONSE"
echo ""
echo "=========================================="
echo "🎉 Selesai!"
echo "=========================================="
