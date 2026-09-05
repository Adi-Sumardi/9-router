# Panduan Ekstensi SendaGo AI Assistant (v0.2.0 — Agentic Edition)

Ekstensi **SendaGo AI** untuk VS Code & Antigravity IDE kini telah di-upgrade ke **v0.2.0** dengan kapabilitas **Autonomous Agent, Plan Mode, dan Auto-Edit File langsung di workspace**.

---

## 🌟 Fitur Utama v0.2.0

### 1. 🔘 Mode Switcher Tab (Di Header Sidebar):
* **💬 Chat Mode:** Tanya jawab seputar kode, penjelasan algoritma, dan diskusi santai.
* **📋 Plan Mode:** Mode Arsitek Senior. AI menganalisis kebutuhan Anda dan menyusun **Checklist Langkah Kerja Interaktif (*Milestones*)** dengan tombol eksekusi perintah terminal per langkah.
* **⚡ Auto-Edit (Agent Mode):** Mode Engineer Otonom. AI membaca file aktif dan menghasilkan usulan perubahan dengan kartu aksi:
  * **`[ 🔍 View Diff ]`**: Membuka perbandingan visual berdampingan sebelum kode diubah.
  * **`[ ✅ Apply to File ]`**: Menerapkan perubahan secara instan ke file di workspace tanpa perlu copy-paste manual.

---

### 2. 🎛️ Model Routing Pool:
* **🟡 Hybrid (Auto-Fallback):** Otomatis mencari model Claude Sonnet 4.6 ➡️ Gemini 3.7 Flash ➡️ Groq LPU jika limit.
* **🟢 Free Tier ($0 Cost):** Menggunakan model gratis super cepat `groq/openai/gpt-oss-120b`.
* **🔵 Pro Tier:** Menggunakan model penalaran tinggi `claude-virtually-unlimited`.

---

## 🚀 Cara Menggunakan Fitur Auto-Edit:

1. Buka file kode yang ingin Anda ubah di editor (misal: `src/auth.ts`).
2. Klik tab **⚡ Auto-Edit** di sidebar SendaGo AI.
3. Ketik instruksi Anda:
   > *"Tolong tambahkan fungsi validasi password menggunakan bcrypt dan export fungsinya."*
4. AI akan menganalisis file dan memunculkan kartu aksi:
   ```
   ┌──────────────────────────────────────────────────────────┐
   │ 📄 src/auth.ts (Tambah fungsi verifyPassword)            │
   │ [ 🔍 View Diff ]   [ ✅ Apply to File ]                  │
   └──────────────────────────────────────────────────────────┘
   ```
5. Klik **`View Diff`** untuk melihat perubahan, lalu klik **`Apply to File`** ➡️ Kode di editor Anda **langsung berubah seketika!** 🪄

---

## 📋 Cara Menggunakan Plan Mode:

1. Klik tab **📋 Plan Mode** di sidebar SendaGo AI.
2. Ketik rencana besar Anda:
   > *"Rencanakan refactoring arsitektur database dari SQLite ke PostgreSQL."*
3. AI akan menghasilkan rencana terstruktur lengkap dengan checklist:
   ```
   ┌──────────────────────────────────────────────────────────┐
   │ 📋 Execution Plan (3 Steps)                              │
   │ [ ] Step 1: Pasang postgres library                      │
   │     ▶ Run: npm i pg @types/pg                            │
   │ [ ] Step 2: Update database connection config            │
   │ [ ] Step 3: Jalankan migration test                      │
   └──────────────────────────────────────────────────────────┘
   ```
4. Anda bisa klik tombol **`▶ Run: npm i ...`** untuk langsung menjalankan perintah terminal yang disarankan AI!

---

## ⌨️ Shortcut & Command Palette

Tekan `Cmd + Shift + P` di VS Code / Antigravity IDE:
* **`SendaGo: Open AI Assistant`** (`Cmd+Shift+A`)
* **`SendaGo: Start Plan Mode`**
* **`SendaGo: Auto-Edit Active File`**
* **`SendaGo: Explain Selected Code`**
* **`SendaGo: Find & Fix Bugs in Selection`**
* **`SendaGo: Generate Unit Tests`**
* **`SendaGo: Optimize & Refactor Code`**
