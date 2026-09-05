# Changelog

Semua perubahan penting pada ekstensi SendaGo AI Assistant dicatat di sini.
Versi sebelum 0.6.0 tidak memiliki catatan detail — lihat riwayat `.vsix` sebelumnya
sebagai referensi kasar (fitur Auto-Edit, Plan Mode, dan Model Routing Pool diperkenalkan
bertahap dari 0.1.0 sampai 0.5.0).

## 0.9.5 — Fix: Lock Was Set Too Late, After Two Internal Auto-Scrolls Already Fired

Follow-up to 0.9.4: the lock itself was correct, but it was still being armed *after* the
two calls that most needed it had already run.

### Fixed
- `sendMessage()` called `appendUserMessage()` and `createAssistantMessage()` — each of
  which triggers its own internal `autoScrollIfNearBottom()` — and only set
  `scrollAnchorLocked = true` afterward. Both calls ran while the lock was still `false`,
  so they jumped the view to the bottom exactly as before; the subsequent
  `scrollIntoView({ block: 'start' })` was scheduled but the immediate visual jump had
  already happened by then in practice. The lock now flips to `true` as the very first
  line of `sendMessage()`, before any element is appended, so neither of those internal
  auto-scrolls can fire at all during this turn's setup.

## 0.9.4 — Fix: Scroll Anchor Race Condition on Longer Conversations

Follow-up to 0.9.3: the prompt scroll-anchor fix worked for the first couple of messages
in a session but reverted to jumping to the bottom from the 3rd message onward.

### Fixed
- Root cause was a race condition: `sendMessage()` scheduled the anchor scroll via
  `requestAnimationFrame`, but the very first streamed `chunk` for the response could
  arrive and trigger `autoScrollIfNearBottom()` *before* that frame ran — and right after
  appending the new prompt, the container legitimately still counted as "near bottom", so
  that first chunk would win the race and force-scroll down before the anchor ever had a
  chance. Early in a session, "top of the new prompt" and "the very bottom" are close
  enough that this wasn't noticeable; the more content accumulates, the more they diverge,
  which is why it only became visible from message 3 onward.
- Replaced the timing-dependent approach with an explicit lock: `lockScrollAnchor()` sets a
  flag that makes `autoScrollIfNearBottom()` a no-op for the entire duration of that turn,
  removing the race entirely. The lock is released in the `done`/`stopped`/`error`
  handlers (and defensively at the start of the next `sendMessage()`) so normal
  follow-the-bottom behavior resumes afterward.

## 0.9.3 — Fix: Chat History Leak, Invisible Timeline Line, Prompt Scroll Anchor

Batch of fixes from continued user testing.

### Fixed
- **Chat history showed raw internal directive text as fake user messages.** The
  `nativeNudge`/legacy directive/final-summary-turn messages injected into `_history` to
  steer the model (added in 0.9.0–0.9.2) are pushed with `role: 'user'`, and the session
  history loader only filtered a few hardcoded legacy prefixes — so opening an old
  conversation showed repeated `"[Directive: Tool results above are ready...]"` bubbles
  instead of the real conversation. `ChatMessage` now has an explicit `internal` flag;
  `SessionManager` only persists/displays genuine user prompts and non-empty assistant
  replies (`isVisibleMessage`/`sanitizeMessagesForHistory` in `sessionManager.ts`), and
  strips orphaned `tool_calls` from any assistant message whose paired tool results were
  dropped. Applied retroactively when loading old sessions too, not just new saves.
- **The connected timeline line was invisible in every prior 0.9.x release** — turns out
  `--border-soft`, `--text-muted`, `--accent`, `--accent-2`, and `--accent-soft` were
  referenced across the stylesheet (including the new `.agent-timeline` connector) but
  never actually defined as CSS custom properties. For a non-inherited property like
  `background`, an unresolved `var()` computes to `transparent` — so the line was always
  rendered, just completely invisible. Added them as aliases to the tokens that were
  clearly intended (`--claude-border`, `--claude-text-muted`, `--sendago-maroon` family),
  fixing this and several other silently-mis-colored elements at once.
- Added actual dot markers on each timeline node (gray/pulsing-red while running, green on
  success, red on failure) to match Claude Code's own connected-timeline look.
- **A newly sent prompt was immediately pushed out of view** by the very next auto-scroll
  once a response/tool-call started streaming below it. Scrolling now only auto-follows
  the bottom if the viewport was already near the bottom (`autoScrollIfNearBottom`), and
  sending a new message explicitly anchors that message to the *top* of the viewport
  (`scrollIntoView({ block: 'start' })`) so it stays visible while the answer fills in below
  — matching ChatGPT/Claude.ai's behavior instead of chasing the latest line to the bottom.

### Changed
- User-facing label "Surgical Replace" renamed to "Perbaikan Code" in the auto-exec toast
  and the manual review panel header.

## 0.9.2 — Fix: Timeline Grouping for Single-Action Turns + Network Hang Timeout

Follow-up to 0.9.1 based on user testing: the connected timeline from 0.9.1 still looked
disconnected in practice, and a separate report showed the extension getting permanently
stuck mid-task with no output and no error.

### Fixed
- **Timeline grouping didn't help when a model does one action per turn** (very common —
  e.g. one `replace_in_file` call per turn with no narration text). The timeline was reset
  on every new assistant bubble, so each turn's single toast ended up alone in its own group
  of one, making the connecting line pointless. Now the timeline only resets after a bubble
  that actually contains real text; an empty bubble (pure tool call, no narration) is
  removed from the DOM entirely instead, so activity across many consecutive tool-only turns
  stays visually connected in one continuous timeline — until the model actually says
  something, which starts a fresh segment.
- **`streamChat` had no timeout beyond the user's own Stop button.** If the 9Router gateway
  or an upstream model provider hung mid-stream (network hiccup, provider outage), the
  extension would wait forever with the loader spinning and no error — exactly what one
  user hit on a long multi-file task. Both the initial request and each subsequent stream
  chunk now have a 90-second inactivity timeout (reset on any new data), surfaced as a clear
  error message instead of an indefinite silent hang.

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
