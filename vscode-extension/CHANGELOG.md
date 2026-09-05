# Changelog

Semua perubahan penting pada ekstensi SendaGo AI Assistant dicatat di sini.
Versi sebelum 0.6.0 tidak memiliki catatan detail — lihat riwayat `.vsix` sebelumnya
sebagai referensi kasar (fitur Auto-Edit, Plan Mode, dan Model Routing Pool diperkenalkan
bertahap dari 0.1.0 sampai 0.5.0).

## 0.9.1 — Cleaner, Connected Agent Activity Timeline

Follow-up to 0.9.0 based on user feedback comparing SendaGo's chat UI to Claude Code's own
clean, sequential timeline — SendaGo's felt "kaku dan tidak berurutan" (rigid, disjointed)
by comparison.

### Changed
- Removed the redundant duplicate progress indicators that fired on every autonomous loop
  step: the numeric `"⚡ Step N/M: ..."` badge and the separate `"🧠 Memeriksa kembali..."`
  pulse said the same thing twice per step. The new assistant bubble already shows its own
  shimmer loader while waiting, so neither was adding information — just noise, and looked
  especially mechanical now that the step ceiling is 50 instead of 8.
- Terminal blocks, auto-exec toasts, and completion badges that occur between two AI
  responses are now grouped into one connected `.agent-timeline` container (shared left
  border + tight spacing) instead of floating as separate boxes with large gaps — closer
  to how Claude Code visually chains a tool call to its result.

## 0.9.0 — Dynamic Stopping: Stagnation Detection Instead of a Hard Step Wall

Follow-up to 0.8.2 based on user testing: a hardcoded "step limit reached" warning box
was still the wrong fix — it papered over the symptom instead of the real problem, and
capped genuinely complex multi-step tasks at an arbitrary number.

### Changed
- `sendago.maxAutonomousSteps` default raised from 8 to **50**, and reframed as a
  last-resort safety ceiling rather than a target step count. Description updated to
  clarify this. Raise it further in Settings for very complex tasks.
- The loop no longer relies on the step counter as its primary stopping signal. It now
  fingerprints every turn's requested actions (`computeActionSignature`) and detects
  **stagnation**: if the exact same tool call (same grep query, same command, etc.)
  repeats 3 times in a row with no new progress, the loop stops — regardless of how many
  steps remain. A task where every step is genuinely different can run far longer without
  ever hitting this.
- Whenever the loop stops early (stagnation OR the safety ceiling), it now runs one final
  no-tools turn (`runFinalSummaryTurn`) asking the model to summarize, in natural
  Indonesian, what was accomplished and what remains — so the user always gets a real
  conclusion instead of a raw warning box. Falls back to a plain-text notice only if that
  final call itself returns nothing.

## 0.8.2 — Fix: Autonomous Loop Silent at Last Step

### Fixed
- **Bug ditemukan saat testing user**: pada mode Claude Code/Agent dengan native
  tool-calling (0.7.0+), agent bisa terjebak memanggil tool baca (grep/read) berulang
  tanpa pernah menjawab atau memanggil `task_done`, sampai `maxAutonomousSteps` (default 8)
  habis — dan begitu limit tercapai, percakapan berhenti TOTAL diam tanpa kesimpulan apa
  pun (UI macet di badge "Step 8/8: Menyempurnakan..."). Dua akar penyebab:
  1. Jalur native tool-calling tidak pernah menyertakan directive "lanjutkan/jawab
     sekarang" seperti jalur tag-teks legacy — sepenuhnya bergantung pada kecenderungan
     agentic model, yang tidak konsisten di model gratisan/hybrid. Sekarang jalur native
     juga mendapat nudge yang sama setelah setiap hasil tool.
  2. Kalau iterasi terakhir yang diizinkan masih meninggalkan pekerjaan tertunda, loop
     keluar lewat kondisi `while` tanpa pemberitahuan. Sekarang dideteksi eksplisit dan
     ditampilkan pesan jelas: "⚠️ Batas langkah otonom tercapai (N/N)..." alih-alih diam.

## 0.8.1 — Test & Lint Infrastructure (Maintenance)

### Added
- Unit test suite (`test/agentEngine.test.ts`, Node's built-in `node:test`) untuk seluruh
  fungsi `parse*` dan `buildActionsFromToolCalls` di `agentEngine.ts` — 25 test, dijalankan
  via `npm test` (esbuild bundle + `node --test`, tanpa dependency test-runner tambahan).
- ESLint (flat config, `typescript-eslint`) via `npm run lint`.
- `CHANGELOG.md` ini.

### Changed
- `agentEngine.ts` memakai `import type` untuk `ProjectContext`/`ToolCallData` — memastikan
  modul ini benar-benar tanpa dependency runtime ke `vscode`, sehingga bisa di-unit-test di
  luar extension host.

## 0.8.0 — Governance & Project-level Permission Policy

### Added
- `.sendago/settings.json` — kebijakan permission milik REPO (mirip `.claude/settings.json`
  di Claude Code), menang atas setting personal `sendago.autoExecute`:
  - `permissionMode`: `"auto"` | `"ask"` | `"plan-only"` (read-only total, tombol Apply/Run
    dikunci server-side, bukan cuma disembunyikan di UI).
  - `allow` / `deny`: pola regex tambahan untuk perintah terminal. `deny` adalah hard-block
    tanpa opsi konfirmasi manual, setara `PreToolUse deny` hook di Claude Code.
- Slash command `/permissions` untuk membuat & membuka `.sendago/settings.json`.
- Toggle Auto/Ask di UI otomatis terkunci ("🔒 Plan-Only") ketika kebijakan proyek aktif.

### Fixed
- Chat mode (dan mode lain tanpa auto-execute) sekarang benar-benar bisa memakai hasil
  `grep_workspace` / `find_files` / `read_file` — sebelumnya tool read-only ini diam-diam
  tidak pernah dieksekusi di luar mode Agent/Claude-Code dengan autoExecute aktif, dan
  hasilnya (kalaupun ada) tidak pernah sampai balik ke model karena loop langsung berhenti.
  Aksi tulis/eksekusi (edit/replace/command) tetap memerlukan mode autonomous seperti semula.
- `/compact` bisa menyisakan pesan assistant dengan `tool_calls` tanpa `tool` result
  pasangannya, membuat request berikutnya ke provider native tool-calling ditolak (400).
- Turn yang berhenti mendadak (abort/error) di tengah eksekusi native tool-call kini
  ditambal otomatis (`repairDanglingToolCalls`) supaya histori sesi tetap valid disimpan.

## 0.7.1 — Chat-mode read tool fix (lihat detail 0.8.0 di atas, dirilis terpisah sebelum Fase 3)

## 0.7.0 — Hybrid Native Tool-Calling

### Added
- Skema `tools` OpenAI-compatible (`toolSchemas.ts`) untuk 8 aksi (run_command, edit_file,
  replace_in_file, grep_workspace, find_files, read_file, generate_image, task_done) plus
  `create_plan` khusus Plan Mode.
- `routerClient.streamChat` mengirim `tools` di setiap request dan mengakumulasi
  `delta.tool_calls` dari SSE stream jadi tool call terstruktur.
- Provider yang mendukung native function-calling otomatis memakai jalur ini; provider yang
  tidak mendukungnya (banyak model gratisan di pool free/hybrid) tetap memakai tag teks
  `<sendago_*>` seperti sebelumnya tanpa perubahan — kedua jalur dieksekusi lewat kode yang
  sama (`AgentEngine.buildActionsFromToolCalls`).

## 0.6.0 — Security Hardening

### Added
- API Key gateway dipindah dari `settings.json` plaintext ke VS Code Secret Storage
  (terenkripsi OS keychain), dengan migrasi otomatis satu kali dari key lama.
- Content-Security-Policy + nonce pada webview sidebar (defense-in-depth terhadap XSS).
- Pengecekan VS Code Workspace Trust — di workspace yang belum "Trusted", eksekusi otomatis
  (command & file write) dinonaktifkan sementara dan diperlakukan seperti mode Ask.
- Allowlist perintah aman (`isSafeAutoCommand`) untuk auto-run, menggantikan model lama yang
  auto-run semua perintah kecuali cocok blocklist berbahaya.

### Fixed
- Command yang di-auto-run oleh autonomous loop sempat dieksekusi dua kali (sekali di
  server, sekali lagi dipicu ulang oleh client webview).
- Dua pola destruktif tambahan (`shutil.rmtree`, `fs.unlinkSync`) ditambahkan ke blocklist
  untuk menutup celah delete lewat interpreter one-liner.

## Sebelum 0.6.0

Riwayat detail tidak tercatat. Fitur utama yang sudah ada: Chat/Plan/Agent mode switcher,
Auto-Edit dengan diff preview, surgical search-and-replace, grep/find/read workspace,
terminal execution dengan live streaming, session history, dan Model Routing Pool
(Free/Pro/Hybrid) melalui gateway 9Router.
