# Changelog

Semua perubahan penting pada ekstensi SendaGo AI Assistant dicatat di sini.
Versi sebelum 0.6.0 tidak memiliki catatan detail — lihat riwayat `.vsix` sebelumnya
sebagai referensi kasar (fitur Auto-Edit, Plan Mode, dan Model Routing Pool diperkenalkan
bertahap dari 0.1.0 sampai 0.5.0).

## 0.13.2 — Fix: Cheap Model Could Declare the Whole Task Finished Halfway Through

Reported: work consistently stopped mid-execution and jumped straight to a summary.

### Fixed
- The anti-degradation guard only watched for write/exec actions, so `task_done` slipped
  through. A cheap model will happily decide it's "done" after a single look at some grep
  output — and `task_done` ends the loop immediately and renders the completion summary, so
  the task stopped halfway with a conclusion attached. `task_done` from the light model is
  now discarded and the step re-run on the primary model, which decides whether the work is
  genuinely finished.
- The guard also fires when the light model returns **no actionable step at all** (just
  prose). Previously that ended the turn via the "nothing executed" exit, which was another
  way for work to stop early.
- Added an efficiency backstop: if the light model overreaches twice in one turn, rotation
  is switched off for the rest of that turn. Without it, every light step could cost two
  calls (light attempt + primary redo) and the token saver would become a net loss.

## 0.13.1 — Fix: Token Saver Left the Agent Stuck in Exploration, Never Writing Code

Regression from 0.12.0 reported by the user: after entering a prompt, code was no longer
being executed.

### Fixed
- The token saver gave the light model **only read-only tools**, on the reasoning that this
  made it structurally impossible for it to author code. That backfired: a model using
  native tool-calling can only act through the tools it is given, so once a turn fell to
  the light model it had no way to signal "time to write" and could only keep reading. The
  anti-degradation guard never fired because it watches for a write action, which the model
  could no longer produce. The agent stayed in exploration and never got to the edits.
- The light model now receives the **full** tool set, so it can express intent to write; the
  guard then discards that attempt and re-runs the step on the primary model. Code quality
  is protected by the guard, not by removing the tools.
- Added a cap of 2 consecutive light steps. Even without any write action, control returns
  to the primary model after that, so a long exploration can't drift indefinitely on the
  cheap model and feel slow to start real work.

## 0.13.0 — Animated SendaGo Mascot as the "Working" Indicator

The grey shimmer dot made the UI look frozen while code was being written or a command was
running. The mascot artwork the user supplied (`maskot.png`) is a 4×3 sprite sheet of 12
poses whose captions already matched the rotating loading messages.

### Added
- Sliced the sprite sheet into 12 individual poses (`media/mascot/mascot-01..12.png`, 128px,
  ~25 KB each) by detecting each pose's own bounding box and pasting it onto a transparent
  square canvas — cropping to a fixed grid pulled neighbouring caption text into several
  frames, since a square centred on a wide pose overflows its row band.
- The mascot is now the working indicator everywhere there's a wait: composing an answer
  (poses rotate through the 11 working states in step with the label), writing a file
  (locks to the laptop pose with the filename), running a command (gear pose in the
  terminal badge), drafting the summary (paper-plane pose), and task completion (the
  green-check pose, static).
- `prefers-reduced-motion` stops the bobbing animation but keeps the mascot visible.

### Changed
- The working indicator moved out of `.message-content` into a separate persistent
  `.message-working` element. `message-content` is rewritten on every streamed chunk — with
  the mascot inside it, the `<img>` was recreated dozens of times per second and its CSS
  animation restarted from frame zero each time, so the mascot appeared frozen: the exact
  opposite of the point. Pose changes now swap `src` on the same element, leaving the
  animation running.

## 0.12.1 — Auto-Follow the Latest Message Again (Without Losing the Prompt Anchor)

The 0.11.1 prompt-anchor fix disabled auto-scroll for the entire turn to protect the
anchor, which meant the user had to scroll manually to watch a response come in.

### Fixed
- Replaced the blanket "no auto-scroll during a turn" lock with a `followBottom` flag kept
  in sync with the real scroll position via a `scroll` listener on the message list. The
  view now follows new content automatically, stops following the moment the user scrolls
  up to read something, and resumes as soon as they return to the bottom. Sending a new
  prompt always re-enables following.
- The two behaviours coexist rather than conflict: the new prompt is still anchored near
  the top on send, and because the bottom spacer sizes the area below it to roughly one
  viewport, following the bottom keeps the prompt at the top until the answer actually
  grows past a screenful — then it scrolls away naturally, as it should.
- Programmatic scrolls are timestamp-guarded so the listener doesn't mistake our own
  smooth anchor animation for the user scrolling away and switch following off.

## 0.12.0 — Token Saver: Models Take Turns Instead of One Doing Everything

Previously a 20-step autonomous task called the pool's primary model 20 times, including
for steps that only digest grep/read output. Models now rotate by the kind of work.

### Added
- `sendago.tokenSaver` setting (default `true`). Each turn now resolves a **model plan**
  with two complementary chains: `chain` for heavy steps (writing code, running commands,
  fixing errors) and `lightChain` — cheapest available model first — for light steps
  (digesting read-only results, writing the final summary).
- Steps are classified from what the *previous* step did: after a purely read-only turn
  that hit no failures, the next step runs light; any write/exec action or any failure
  (replace not found, non-zero exit, unreadable file) sends it straight back to the
  primary model. The final summary turn always runs light.
- **Anti-degradation guard** — the light model is never allowed to author code. It is only
  given read-only tools (`grep_workspace`, `find_files`, `read_file`, `task_done`), and if
  it nevertheless emits a write/exec action through the text-tag fallback path, that
  attempt is discarded (its partial output cleared from the bubble) and the same step is
  re-run on the primary model. The discarded attempt never enters conversation history.
- Pool `pro` is exempt from downgrading to a free-tier model even for light steps, per the
  paid/* policy in ARCHITECTURE.md.

### Changed
- Model ordering logic extracted to `src/modelRouting.ts` as pure functions
  (`categorizeModel`, `buildModelChain`, `buildLightChain`) and covered by 14 new unit
  tests — these rules decide both cost and quality, so they needed to be testable rather
  than buried in a class that depends on `vscode`. Test suite is now 39 tests.

## 0.11.1 — Fix: The Actual Reason the Prompt Never Stayed at the Top

Three previous attempts (0.9.3, 0.9.4, 0.9.5) treated this as a timing/race problem and
kept failing. It wasn't timing at all — it was a physical scroll limit.

### Fixed
- A browser can only scroll a container to `scrollHeight - clientHeight`. The message just
  sent is the **last** element in the list, so no amount of `scrollIntoView({block:'start'})`
  can lift it to the top of the viewport — there is simply nothing below it to fill the
  screen. Every earlier fix was scrolling correctly and then being clamped back by the
  browser, which looked identical to "the anchor lost a race".
- Added a dynamic bottom spacer (the approach ChatGPT/Claude.ai use): on send, enough empty
  space is reserved below the message for it to reach the top, then that space shrinks
  automatically as the response and tool activity fill it in, so no empty gap is left over
  at the end. `scrollIntoView` was also replaced with a direct `scrollTo` computed from the
  element's offset within the scroll container, which behaves deterministically in a webview.

## 0.11.0 — Five Community Skills Baked Into the System Prompt

Added condensed, faithful directives distilled from five external skills into
`AgentEngine.getSystemPrompt()` — SendaGo has no dynamic skill-loading system like Claude
Code's `.claude/skills/`, so these are folded directly into the always-sent base prompt
rather than installed as separate loadable files. `no-ai-slop` and `unslop` were merged
into one consolidated writing-style directive since both target the same problem (AI-sounding
prose) and duplicating near-identical rules would only waste prompt tokens.

- **Directive #1 (enhanced)** — [DietrichGebert/Ponytail](https://github.com/DietrichGebert/Ponytail):
  explicit 7-rung decision hierarchy before writing new code (does it need to exist? →
  reuse → stdlib → platform-native → existing dependency → one-liner → new minimal
  implementation), replacing the vaguer "avoid over-engineering" line. Validation, error
  handling, security, and accessibility are called out as non-negotiable at every rung.
- **Directive #3 (new)** — [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) +
  [MohamedAbdallah-14/unslop](https://github.com/MohamedAbdallah-14/unslop): a concrete
  list of AI-sounding patterns to avoid in every response (throat-clearing openers, forced
  binary contrasts, stock vocabulary like "seamless"/"pivotal", unattributed claims,
  pseudo-profound closers, monotone sentence rhythm) plus what to do instead.
- **Directive #12 (new, scoped)** — [nateherkai/scroll-craft](https://github.com/nateherkai/scroll-craft):
  scroll-driven web animation principles (scroll as timeline, one bespoke interaction per
  site, feeling-curve design, strict typography/spacing, real depth techniques) — only
  meant to engage when the user explicitly asks for a scroll-animated site.
- **Directive #13 (new, scoped)** — [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill):
  condensed UI/UX workflow (infer product context → respect existing design-system files →
  establish tokens before per-component styling) and non-negotiable accessibility minimums
  (WCAG contrast, keyboard nav, 44×44px touch targets) — scoped to actual UI/design tasks.

## 0.10.0 — Real Multi-Model Fallback (Sonnet 5 High / Free Tier / Hybrid / Pro)

### Analysis
User asked why "Sonnet 5 High" and "Free Tier" never fell back beyond a single model
despite having many providers enabled on their 9Router gateway. The answer was in the
code: `resolveModelForPool()` mapped every pool to exactly one hardcoded model ID string
(`claude-sonnet-5-fusion`, `free-coding`, `claude-virtually-unlimited`) — the extension
sent that one string per request with zero retry-to-a-different-model logic anywhere.
Any cross-model fallback that appeared to happen was entirely up to how the *gateway*
interpreted that specific model ID server-side, invisible to and uncontrolled by this
extension. Also found: "Hybrid" and "Sonnet 5 High" resolved to the identical model ID
(likely an unintentional duplicate — ARCHITECTURE.md describes Hybrid as a distinct
subscription→cheap→free cascade). Separately, the plumbing to fetch the real list of
active models (`getAvailableModels()` → `/v1/models`) already existed but was wired to a
no-op on the client side, deliberately disabled per an existing code comment ("Model
spesifik dihilangkan agar dropdown rapi").

### Added
- `NineRouterClient.resolveModelChainForPool()` builds an actual ordered list of fallback
  candidates per pool from the models really active on the gateway (cached 60s), instead
  of a single fixed ID. Candidates are loosely categorized as `free`/`pro`/`other` by
  name pattern (`/v1/models` doesn't expose real tier metadata) to order the chain
  sensibly per pool's documented intent:
  - `pro`: primary → other pro-ish models. Never falls back to a free-tier model.
  - `free`: primary → other free-ish models → everything else → pro (last resort).
  - `hybrid`: primary → pro → everything else → free (subscription → cheap → free).
  - everything else (Sonnet 5 High/fusion): primary → all other active models, broad.
- `SendaGoSidebarProvider.streamChatWithFallback()` walks that chain, automatically
  retrying with the next candidate on any non-abort error (network, timeout, HTTP error)
  and remembering which candidate last succeeded so subsequent autonomous-loop steps
  don't re-try a model already known to be down. Surfaces a visible
  `"⚠️ Model X tidak merespons — otomatis beralih ke Y"` message when a fallback occurs.
  A partially-streamed response from a failing model is cleared from the bubble
  (`resetCurrentBubble`) before the next candidate's text starts filling it, so output
  from two different models never gets concatenated together.

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
