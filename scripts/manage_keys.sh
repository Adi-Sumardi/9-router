#!/usr/bin/env bash

# ==============================================================================
# SendaGo AI Gateway — API Key Management CLI
# ==============================================================================

set -eo pipefail

ROUTER_CONTAINER="${ROUTER_CONTAINER:-9router}"
if ! docker ps --format '{{.Names}}' | grep -q "${ROUTER_CONTAINER}"; then
    ROUTER_CONTAINER="sendago-gateway"
fi

show_help() {
    echo "=================================================="
    echo "🔑 SendaGo AI Gateway — API Key Manager"
    echo "=================================================="
    echo "Penggunaan:"
    echo "  $0 list                     - Menampilkan semua API Key yang aktif"
    echo "  $0 create <NAME> [ROLE]     - Membuat API Key baru untuk anggota tim"
    echo "  $0 revoke <KEY_ID>          - Menghapus / mencabut API Key"
    echo ""
    echo "Contoh:"
    echo "  $0 create 'Adi (MacBook)' admin"
    echo "  $0 create 'Developer 1 (VS Code)' user"
    echo "=================================================="
}

cmd_list() {
    echo "📋 Mengambil daftar API Key dari database..."
    docker exec "${ROUTER_CONTAINER}" node -e "
    const db = require('better-sqlite3')('/app/data/db/data.sqlite');
    const keys = db.prepare('SELECT id, key, name, machineId, isActive, createdAt FROM apiKeys').all();
    console.log(JSON.stringify(keys, null, 2));
    "
}

cmd_create() {
    local name="$1"

    if [ -z "${name}" ]; then
        echo "❌ Error: Nama pemilik kunci wajib diisi."
        echo "Contoh: $0 create 'Budi Developer'"
        exit 1
    fi

    echo "⚙️ Membuat API Key baru untuk: ${name}..."
    docker exec "${ROUTER_CONTAINER}" node -e "
    const db = require('better-sqlite3')('/app/data/db/data.sqlite');
    const crypto = require('crypto');
    const id = crypto.randomUUID();
    const rawKey = 'sk-sendago-' + crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    
    db.prepare('INSERT INTO apiKeys (id, key, name, machineId, isActive, createdAt) VALUES (?, ?, ?, null, 1, ?)')
      .run(id, rawKey, '${name}', now);
      
    console.log('\n✅ BERHASIL MEMBUAT API KEY BARU!');
    console.log('--------------------------------------------------');
    console.log('ID   :', id);
    console.log('Name :', '${name}');
    console.log('Key  :', rawKey);
    console.log('--------------------------------------------------');
    console.log('💡 Bagikan kunci di atas ke anggota tim Anda.');
    "
}

cmd_revoke() {
    local key_id="$1"

    if [ -z "${key_id}" ]; then
        echo "❌ Error: ID API Key wajib diisi."
        echo "Gunakan '$0 list' untuk melihat ID kunci."
        exit 1
    fi

    echo "🗑️ Mencabut API Key ID: ${key_id}..."
    docker exec "${ROUTER_CONTAINER}" node -e "
    const db = require('better-sqlite3')('/app/data/db/data.sqlite');
    const info = db.prepare('DELETE FROM apiKeys WHERE id = ?').run('${key_id}');
    if (info.changes > 0) {
      console.log('✅ API Key berhasil dicabut / dihapus.');
    } else {
      console.log('❌ API Key tidak ditemukan.');
    }
    "
}

case "$1" in
    list)
        cmd_list
        ;;
    create)
        cmd_create "$2" "$3"
        ;;
    revoke)
        cmd_revoke "$2"
        ;;
    *)
        show_help
        ;;
esac
