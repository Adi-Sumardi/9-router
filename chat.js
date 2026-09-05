#!/usr/bin/env node

/**
 * 9Router Terminal Chat & Coding Assistant
 * Interactive CLI client for 9Router local AI Gateway
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

// 1. Dapatkan URL & API Key dari .env
let apiKey = process.env.ROUTER_API_KEY || '';
const routerUrl = process.env.ROUTER_URL || 'http://127.0.0.1:20128/v1';

if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const match = envContent.match(/^ROUTER_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].replace(/["']/g, '').trim();
}

if (!apiKey) {
  console.error('❌ ROUTER_API_KEY tidak ditemukan. Set environment variable ROUTER_API_KEY atau isi di file .env sebelum menjalankan chat.js.');
  process.exit(1);
}

// ANSI Color Codes for beautiful terminal styling
const C = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const defaultModel = process.argv[2] || 'ag/gemini-3.7-flash-high';

console.log(`${C.cyan}╔════════════════════════════════════════════════════════════╗${C.reset}`);
console.log(`${C.cyan}║${C.bright}   🚀 9Router Terminal AI Coding & Chat Assistant          ${C.reset}${C.cyan}║${C.reset}`);
console.log(`${C.cyan}╚════════════════════════════════════════════════════════════╝${C.reset}`);
console.log(`${C.gray}Endpoint: ${routerUrl} | Model: ${C.green}${defaultModel}${C.reset}`);
console.log(`${C.gray}Ketik ${C.yellow}'exit'${C.gray} atau ${C.yellow}'quit'${C.gray} untuk keluar, atau ${C.yellow}'clear'${C.gray} untuk reset riwayat percakapan.${C.reset}\n`);

const conversationHistory = [
  { role: 'system', content: 'You are an expert AI software engineer and helpful assistant. Provide clear, accurate code and explanations.' }
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${C.cyan}${C.bright}You > ${C.reset}`
});

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();

  if (!input) {
    rl.prompt();
    return;
  }

  if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
    console.log(`${C.yellow}Sampai jumpa lagi! 👋${C.reset}`);
    process.exit(0);
  }

  if (input.toLowerCase() === 'clear') {
    conversationHistory.length = 1;
    console.clear();
    console.log(`${C.green}✅ Riwayat percakapan dibersihkan.${C.reset}\n`);
    rl.prompt();
    return;
  }

  conversationHistory.push({ role: 'user', content: input });

  process.stdout.write(`\n${C.green}${C.bright}AI (${defaultModel}):${C.reset} `);

  try {
    const response = await fetch(`${routerUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: defaultModel,
        messages: conversationHistory,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.log(`\n${C.red}❌ Error (${response.status}): ${errText}${C.reset}\n`);
      rl.prompt();
      return;
    }

    let fullReply = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // simpan sisa potongan line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              process.stdout.write(delta.content);
              fullReply += delta.content;
            }
          } catch (e) {
            // Abaikan parse error untuk non-JSON SSE heartbeat
          }
        }
      }
    }

    console.log('\n');
    conversationHistory.push({ role: 'assistant', content: fullReply });
  } catch (err) {
    console.log(`\n${C.red}❌ Terjadi kesalahan koneksi: ${err.message}${C.reset}\n`);
  }

  rl.prompt();
});
