# RTK Token Saver — Benchmark & Testing Standard

Dokumen ini mendefinisikan metodologi pengujian untuk mengukur efektivitas fitur **RTK (Real-Time Token) Saver** pada 9Router.

---

## 1. Tujuan Pengujian

1. Mengukur persentase reduksi token input pada berbagai jenis output CLI dan konteks coding.
2. Memverifikasi integritas respon AI (apakah pemotongan/kompresi context menurunkan kualitas kode atau merusak sintaksis JSON).
3. Mengukur penambahan latensi (*overhead*) akibat proses kompresi di layer proxy.

---

## 2. Dataset Pengujian (Test Suites)

| Test Case ID | Tipe Konten | Ukuran Asli (Est. Tokens) | Karakteristik Data |
| :--- | :--- | :--- | :--- |
| **TC-01** | Git Diff Besar | ~15,000 tokens | File diff multi-file dengan banyak baris whitespace dan lockfile. |
| **TC-02** | File Tree / Directory | ~5,000 tokens | Output `tree -L 4` dengan `node_modules` / build artifacts. |
| **TC-03** | Linter & Compiler Logs | ~8,000 tokens | Stack trace error panjang dengan pesan berulang. |
| **TC-04** | Grep / Search Results | ~10,000 tokens | Hasil pencarian regex pada seluruh codebase. |
| **TC-05** | Complex Agent Context | ~30,000 tokens | Riwayat percakapan multi-turn dengan riwayat tool execution. |

---

## 3. Matriks Pengukuran

Setiap test case diuji dengan 2 kondisi: **RTK OFF** vs **RTK ON**.

| Metrik | Definisi | Target Sukses |
| :--- | :--- | :--- |
| **Token Reduction Rate (%)** | `(Tokens_OFF - Tokens_ON) / Tokens_OFF * 100` | >= 20% penghematan |
| **Latency Overhead (ms)** | Waktu tambahan pemrosesan proxy sebelum kirim ke upstream. | < 50ms |
| **Code Correctness** | Model tetap menghasilkan perbaikan kode yang valid dan lulus lint. | 100% Pass |
| **Tool Call Integrity** | JSON argument pada tool calling tidak korup/terpotong. | 100% Valid JSON |

---

## 4. Prosedur Eksekusi Pengujian

1. **Jalankan Baseline (RTK OFF):**
   * Kirim prompt pengujian dengan membawa payload dataset.
   * Catat `prompt_tokens`, `completion_tokens`, dan `total_latency`.
2. **Aktifkan RTK di Dashboard 9Router (RTK ON):**
   * Kirim prompt yang identik.
   * Catat `prompt_tokens`, `completion_tokens`, dan `total_latency`.
3. **Validasi Output:**
   * Jalankan linter/evaluator terhadap kode yang dihasilkan oleh model pada kedua kondisi.
4. **Catat Hasil:** Masukkan hasil ke dalam tabel evaluasi `INSTALL_RESULT.md`.
