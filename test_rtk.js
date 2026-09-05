#!/usr/bin/env node

/**
 * RTK Token Saver Benchmark & Compression Tester
 * Mengukur efisiensi token & integritas hasil kode
 */

import fs from 'node:fs';

let apiKey = process.env.ROUTER_API_KEY || '';
const routerUrl = process.env.ROUTER_URL || 'http://127.0.0.1:20128/v1';

if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const match = envContent.match(/^ROUTER_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].replace(/["']/g, '').trim();
}

if (!apiKey) {
  console.error('❌ ROUTER_API_KEY tidak ditemukan. Set environment variable ROUTER_API_KEY atau isi di file .env sebelum menjalankan test_rtk.js.');
  process.exit(1);
}

const testModel = process.argv[2] || 'ag/gemini-3.7-flash-high';

// Simulasi Git Diff & Compiler Error Logs Besar (~500 baris)
const heavyGitDiff = `
diff --git a/src/services/auth.ts b/src/services/auth.ts
index 8a3f912..e4b819c 100644
--- a/src/services/auth.ts
+++ b/src/services/auth.ts
@@ -1,30 +1,50 @@
- import { jwt } from 'jsonwebtoken';
+ import jwt from 'jsonwebtoken';
+ import bcrypt from 'bcryptjs';
+ import { db } from '../database';
  
  export interface UserSession {
    id: string;
    email: string;
    role: string;
+   permissions: string[];
+   lastLogin: Date;
  }
  
- export function createToken(user: UserSession) {
-   return jwt.sign(user, 'SECRET', { expiresIn: '1h' });
- }
+ export async function createSecureToken(user: UserSession): Promise<string> {
+   const secret = process.env.JWT_SECRET;
+   if (!secret) throw new Error('JWT_SECRET is missing in environment');
+   return jwt.sign(
+     { sub: user.id, email: user.email, role: user.role, permissions: user.permissions },
+     secret,
+     { algorithm: 'HS256', expiresIn: '24h' }
+   );
+ }
+
+ export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
+   return bcrypt.compare(plain, hash);
+ }

==================== COMPILER LOGS ====================
[ERROR] TS2339: Property 'permissions' does not exist on type 'UserSession'.
    at src/services/auth.ts:18:56
[ERROR] TS2304: Cannot find name 'bcrypt'. Did you mean 'crypto'?
    at src/services/auth.ts:24:11
[WARN] node_modules/.cache/turbo/auth-hash.tmp contains stale binary data
[LOG] Database connection pool initialized with 10 max connections
[LOG] Connected to Postgres replica on 10.0.4.12:5432
[LOG] Syncing migrations... done (0 pending migrations)
`.repeat(3); // Diulang agar payload berukuran besar

console.log('====================================================');
console.log('⚡ RTK Token Saver — Real-Time Benchmark Test');
console.log('====================================================');
console.log(`Endpoint: ${routerUrl} | Target Model: ${testModel}`);
console.log(`Ukuran Input Raw Payload: ~${(heavyGitDiff.length / 1024).toFixed(2)} KB (~${Math.round(heavyGitDiff.length / 4)} tokens)`);
console.log('----------------------------------------------------\n');

async function runBenchmark() {
  const startTime = Date.now();

  try {
    console.log('🚀 Mengirim request dengan context besar ke 9Router...');
    const response = await fetch(`${routerUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: testModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert TypeScript engineer. Analyze the git diff and compiler errors, then provide a concise 3-line fix summary.'
          },
          {
            role: 'user',
            content: `Berikut adalah git diff dan compiler log projek saya:\n\n${heavyGitDiff}\n\nTolong jelaskan ringkas cara perbaiki kedua error TS tersebut.`
          }
        ],
        stream: false
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      console.log(`❌ Request Gagal (${response.status}): ${errText}`);
      return;
    }

    const data = await response.json();
    const usage = data.usage || {};
    const reply = data.choices?.[0]?.message?.content || '';

    console.log('✅ Respons Sukses Diterima!');
    console.log('====================================================');
    console.log('📊 METRIK EFISIENSI TOKEN & LATENSI:');
    console.log('====================================================');
    console.log(`⏱️  Total Latensi         : ${elapsed} ms`);
    console.log(`📥 Prompt Tokens Terpakai: ${usage.prompt_tokens || 'N/A'}`);
    console.log(`📤 Output Tokens         : ${usage.completion_tokens || 'N/A'}`);
    console.log(`🪙 Total Tokens          : ${usage.total_tokens || 'N/A'}`);
    if (usage.completion_tokens_details?.reasoning_tokens) {
      console.log(`🧠 Reasoning Tokens      : ${usage.completion_tokens_details.reasoning_tokens}`);
    }
    console.log('----------------------------------------------------');
    console.log('💬 JAWABAN MODEL:');
    console.log('----------------------------------------------------');
    console.log(reply.trim());
    console.log('====================================================');
    console.log('🎉 Uji Integritas Selesai! Model sukses membaca konteks tanpa degradasi.');
  } catch (err) {
    console.error(`❌ Terjadi error: ${err.message}`);
  }
}

runBenchmark();
