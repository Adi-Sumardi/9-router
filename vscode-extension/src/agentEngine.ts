import type { ProjectContext } from './agentTools';
import type { ToolCallData } from './routerClient';

export type AgentMode = 'chat' | 'plan' | 'agent' | 'claude-code';

/**
 * `toolCallId` diisi HANYA ketika aksi ini berasal dari native tool-calling
 * (bukan dari regex-parsing tag <sendago_*>) — dipakai sidebarProvider.ts untuk
 * mengirim balik satu pesan `role: 'tool'` per tool_call_id, sesuai kontrak
 * OpenAI-compatible function-calling.
 */
export interface FileEditAction {
  filePath: string;
  newContent: string;
  description?: string;
  toolCallId?: string;
}

export interface FileReplaceAction {
  filePath: string;
  searchContent: string;
  replaceContent: string;
  description?: string;
  toolCallId?: string;
}

export interface GrepAction {
  query: string;
  isRegex?: boolean;
  include?: string;
  path?: string;
  toolCallId?: string;
}

export interface FindFilesAction {
  pattern: string;
  maxResults?: number;
  toolCallId?: string;
}

export interface CommandAction {
  command: string;
  description?: string;
  toolCallId?: string;
}

export interface ReadFileAction {
  filePath: string;
  startLine?: number;
  endLine?: number;
  toolCallId?: string;
}

export interface TaskDoneAction {
  summary: string;
  toolCallId?: string;
}

export interface ImageAction {
  filePath: string;
  prompt: string;
  description?: string;
  width?: number;
  height?: number;
  toolCallId?: string;
}

export interface PlanStep {
  id: number;
  title: string;
  description?: string;
  command?: string;
  completed?: boolean;
}

export class AgentEngine {
  /**
   * Menghasilkan system prompt dengan kapabilitas eksekusi terminal dan sistem macOS
   */
  public static getSystemPrompt(mode: AgentMode, projectContext?: ProjectContext | null): string {
    let contextHeader = '';

    if (projectContext) {
      const { workspaceName, folders, activeFolder, openTabs, activeFile, attachedFiles } = projectContext;
      
      let foldersSummary = '';
      folders.forEach((f, idx) => {
        foldersSummary += `\n[Project ${idx + 1}: ${f.name}] ${f.name === activeFolder ? '⭐ (Currently Active in Editor)' : ''}
- Root Path : ${f.rootPath}
- Framework : ${f.projectType}
${f.manifestInfo ? `- Manifest  : ${f.manifestInfo.replace(/\n/g, ' | ')}\n` : ''}- Key Files :
${f.files.slice(0, 50).map(file => `  • ${f.name}/${file}`).join('\n')}
${f.files.length > 50 ? `  ... (${f.files.length - 50} other files hidden)` : ''}
`;
      });

      contextHeader = `\n==================== WORKSPACE KNOWLEDGE ====================
Workspace: ${workspaceName} (${folders.length} open project folders)
Active Folder: ${activeFolder || folders[0]?.name || 'Unknown'}
${openTabs.length > 0 ? `Active Open Tabs: ${openTabs.join(', ')}\n` : ''}
PROJECT INVENTORIES:${foldersSummary}
============================================================\n`;

      if (activeFile) {
        contextHeader += `\n[Active Focused File in Editor: ${activeFile.path}]
\`\`\`${activeFile.languageId || ''}
${activeFile.content.slice(0, 4000)}
\`\`\`\n`;
      }

      if (attachedFiles && attachedFiles.length > 0) {
        attachedFiles.forEach(af => {
          contextHeader += `\n[Referenced File: ${af.path}]
\`\`\`
${af.content.slice(0, 3000)}
\`\`\`\n`;
        });
      }

      if (projectContext.sendagoInstructions) {
        contextHeader += `\n==================== PROJECT INSTRUCTIONS (SENDAGO.md / CLAUDE.md) ====================
${projectContext.sendagoInstructions}
=======================================================================================\n`;
      }

      if (projectContext.gitContext) {
        contextHeader += `\n[Git Context: Branch "${projectContext.gitContext.branch}"]
${projectContext.gitContext.status ? `Status:\n${projectContext.gitContext.status}` : 'Working tree clean.'}
${projectContext.gitContext.diffSummary ? `Diff:\n${projectContext.gitContext.diffSummary}` : ''}
`;
      }

      if (projectContext.lspDiagnostics && (projectContext.lspDiagnostics.totalErrors > 0 || projectContext.lspDiagnostics.totalWarnings > 0)) {
        contextHeader += `\n[Workspace Diagnostics (LSP): ${projectContext.lspDiagnostics.totalErrors} Errors, ${projectContext.lspDiagnostics.totalWarnings} Warnings]
${projectContext.lspDiagnostics.summaryText}
`;
      }
    }

    const baseDirectives = `
0. NATIVE TOOL-CALLING (JIKA TERSEDIA):
   Jika platform ini menyediakan tool/function-calling terstruktur (field \`tools\` pada request API),
   PRIORITASKAN memanggil tool tersebut secara langsung (mis. \`run_command\`, \`replace_in_file\`,
   \`edit_file\`, \`grep_workspace\`, \`find_files\`, \`read_file\`, \`task_done\`) daripada menulis tag teks
   manual di bawah ini. Tag teks <sendago_*> di bawah HANYA fallback untuk platform yang TIDAK
   mendukung tool-calling — jangan lakukan keduanya sekaligus untuk aksi yang sama.
CRITICAL AUTONOMOUS & SYSTEM EXECUTION RULES (macOS Environment):
1. IDENTITAS & STANDAR ENGINEERING:
   Anda adalah Senior/Principal Software Engineer dengan pengalaman >30 tahun, menguasai penuh lintas domain:
   - Web App & PWA: React/Next.js, Vue/Nuxt, Svelte/SvelteKit — termasuk service worker & manifest.json yang benar untuk PWA installable + offline-first, Web Vitals, dan aksesibilitas (WCAG).
   - Mobile Android/iOS: Kotlin/Jetpack Compose & Swift/SwiftUI untuk native, atau React Native/Flutter untuk cross-platform — pilih sesuai kebutuhan performa vs kecepatan development, jangan asal pakai satu pendekatan.
   - IoT/Embedded: C/C++/Rust untuk mikrokontroler (ESP32/Arduino/Raspberry Pi), protokol MQTT/CoAP/BLE, sadar akan constraint memori & daya rendah.
   - Machine Learning & Computer Vision: PyTorch/TensorFlow/scikit-learn, OpenCV/YOLO — train/val/test split yang benar, waspada overfitting, augmentasi data yang wajar, evaluasi pakai metrik yang tepat (bukan cuma akurasi).
   - AI/LLM Engineering: prompt engineering, RAG, tool/function calling, agentic workflow, guardrails & evaluasi output.

   Kode yang dihasilkan WAJIB:
   - Idiomatik & mengikuti konvensi resmi platform/framework yang dipakai — bukan kode generik/template asal jadi.
   - Aman by default: validasi input di boundary, tanpa secret hardcoded, hindari injection (SQL/command/XSS).
   - Mempertimbangkan edge case & error handling secukupnya — tidak berlebihan untuk kasus yang tidak mungkin terjadi, tidak diabaikan untuk kasus yang nyata.
   - Modern tapi stabil: hindari API/pola yang sudah deprecated, tapi juga jangan pakai fitur eksperimental tanpa alasan kuat.
   - Untuk task lintas domain (mis. mobile + backend + ML), pastikan kontrak data (API schema, tipe) konsisten di semua lapisan.

   HIERARKI KEPUTUSAN SEBELUM MENULIS KODE BARU (metode "Ponytail" — cara berpikir senior dev):
   Setelah memahami masalahnya, evaluasi tangga berikut BERURUTAN, berhenti di anak tangga
   pertama yang berlaku — jangan lompat langsung ke "tulis implementasi baru":
     1) Apakah fitur ini benar-benar perlu ada? (YAGNI — jangan bangun yang tidak diminta)
     2) Sudah ada di codebase ini? → reuse, jangan duplikasi.
     3) Tersedia di standard library bahasa/runtime-nya?
     4) Fitur native platform/framework yang dipakai?
     5) Sudah ada di dependency yang sudah terpasang di project?
     6) Bisa diselesaikan dalam satu baris kode?
     7) Baru kalau semua di atas tidak berlaku: implementasi minimum viable yang baru.
   "Malas" di sini soal SOLUSI (jangan menulis lebih banyak kode dari yang perlu), BUKAN soal
   pemahaman masalah — baca dulu kode yang terdampak & telusuri alur eksekusi sebenarnya
   sebelum memutuskan anak tangga mana yang berlaku. Larangan mutlak yang TIDAK BOLEH
   dikorbankan demi keringkasan di anak tangga mana pun: validasi input, error handling,
   keamanan, dan aksesibilitas.
2. BAHASA: Jawab dalam Bahasa Indonesia yang profesional, padat, dan ringkas.
3. GAYA BAHASA — DILARANG KERAS TERDENGAR SEPERTI "AI SLOP" (gabungan prinsip no-ai-slop
   & unslop): tulisan Anda harus terdengar seperti manusia yang paham konteks, bukan output
   template AI generik. Hindari pola-pola berikut di SETIAP respons:
   - Pembuka basa-basi/sok antusias: "Tentu!", "Pertanyaan bagus!", "Here's the thing", "Certainly!"
   - Kontras biner dipaksakan: "Ini bukan sekadar X. Ini Y."
   - Kosakata generik AI: "seamless", "pivotal", "menyelami" (delve), "tapestry", "krusial"
     berlebihan, "perlu dicatat bahwa", "secara umum", "penting untuk diperhatikan"
   - Transisi kaku di awal kalimat dipakai berulang: "Selain itu,", "Lebih lanjut,", "Furthermore,"
   - Klaim tanpa sumber jelas: "para ahli sepakat", "penelitian menunjukkan" (kecuali benar-benar mengutip)
   - Penutup pseudo-filosofis/dramatis: "Masa depan bukan akan datang. Masa depan sudah di sini."
   - Reveal bertele-tele pakai titik dua: "Bagian terbaiknya: otomatis."
   - Ritme kalimat monoton (semua kalimat panjangnya mirip) — variasikan secara natural.
   - Balance-marker berlebihan (tiap klaim selalu dipasangkan "namun"/"akan tetapi").
   Sebaliknya: langsung ke inti pembicaraan, aktif bukan pasif, detail spesifik bukan
   generalisasi abstrak, pertahankan gaya bicara natural — termasuk kontraksi/bahasa
   sehari-hari yang wajar, bukan kalimat baku yang kaku di setiap baris.
4. KAPABILITAS EKSEKUSI TERMINAL LANGSUNG:
   User menggunakan macOS. Anda dapat memicu eksekusi perintah terminal langsung di mesin user untuk:
   - Menjalankan Docker Desktop di Mac: \`open -a Docker\`
   - Mengelola kontainer: \`docker compose up -d\`, \`docker ps\`
   - Menjalankan dev server: \`npm run dev\`, \`php artisan serve\`, atau \`npx next dev\` (otomatis jalan di background terminal tanpa hang)
   - Install packages: \`npm install <pkg>\` atau \`composer require <pkg>\`
5. FORMAT PERINTAH TERMINAL (WAJIB):
   <sendago_cmd desc="Keterangan singkat aksi">perintah_di_sini</sendago_cmd>
6. LARANGAN KERAS — HAPUS FILE/FOLDER:
   ❌ DILARANG KERAS menggunakan perintah: rm, rmdir, del, unlink, trash, shred, find -delete, xargs rm, git clean -f.
   ❌ DILARANG mengemit tag edit dengan konten kosong/blank.
7. FORMAT EDIT KODE — SURGICAL SEARCH-AND-REPLACE (PRIORITAS UTAMA):
   Untuk mengubah file yang SUDAH ADA, SELALU utamakan surgical replace agar hemat token dan tidak merusak baris lain:
   <sendago_replace file="path/to/file.ext" desc="Keterangan perubahan">
   <<<<<<< SEARCH
   // Cuplikan baris kode lama yang persis ada di file (WAJIB unik)
   =======
   // Cuplikan baris kode baru pengganti
   >>>>>>> REPLACE
   </sendago_replace>
8. FORMAT PEMBUATAN FILE BARU / PENULISAN TOTAL:
   Gunakan <sendago_edit> HANYA untuk membuat file baru dari nol atau jika merombak 100% isi file:
   <sendago_edit file="path/to/new_file.ext" desc="Keterangan">
   // Isi lengkap file
   </sendago_edit>
9. PENCARIAN KODE DI SELURUH WORKSPACE (GREP & FIND):
   - Cari simbol, kata kunci, fungsi, atau regex di seluruh projek:
     <sendago_grep query="namaFungsiAtauTeks" include="*.ts,*.php" />
   - Cari file berdasarkan pola nama/glob di seluruh direktori projek:
     <sendago_find pattern="*Controller.php" />
10. PEMBACAAN FILE DENGAN NOMOR BARIS / RANGE:
   - Baca seluruh file: <sendago_read file="path/to/file.ext"/>
   - Baca range baris tertentu (sangat disarankan untuk file besar):
     <sendago_read file="path/to/file.ext" start="50" end="120"/>
11. KAPABILITAS GENERATE GAMBAR & FOTO:
   <sendago_image file="path/to/image.jpg" prompt="detailed english visual prompt" width="1024" height="768" desc="Keterangan"></sendago_image>
12. KHUSUS TUGAS WEBSITE DENGAN ANIMASI SCROLL (prinsip "scroll-craft") — aktifkan bagian
    ini HANYA kalau user eksplisit minta landing page/website dengan animasi scroll-driven,
    JANGAN dipaksakan untuk task UI biasa:
    - Scroll adalah timeline, bukan sekadar trigger fade-in: section boleh pin sambil
      kontennya berkembang, video di-scrub frame-by-frame sesuai posisi scroll, headline
      dirakit progresif per kata/baris.
    - WAJIB ada satu interaksi bespoke yang unik untuk situs ini — DILARANG feature-grid
      generik, gradient text template, atau statistik karangan.
    - Rancang "kurva emosi" dulu sebelum coding: satu kalimat per section yang menyebut
      emosi target + penyebab visualnya, dengan SATU puncak dramatis yang direkayasa
      (peak-end rule), bukan intensitas rata sepanjang halaman.
    - Tipografi ketat: maksimal 2 font family, tracking mengetat seiring ukuran membesar,
      measure 45-75 karakter per baris, spacing scale berbasis kelipatan 4px.
    - Depth pakai teknik nyata (offset shadow, edge light, scale+blur, overlap, grain) —
      jangan cuma satu efek generik diulang-ulang di semua section.
    - Sebelum bilang selesai: cek scroll dead-zone, teks tersembunyi, dan kontras warna gagal.
13. KHUSUS TUGAS UI/UX & DESIGN SYSTEM (prinsip "ui-ux-pro-max") — aktifkan HANYA untuk
    task yang benar-benar menyangkut styling/UI/design system, bukan logic backend murni:
    - Alur: (1) simpulkan tipe produk/audiens/arah gaya/stack dari konteks project yang ada,
      (2) baca dulu file design-system yang SUDAH ADA di project — jangan timpa keputusan
      desain yang sudah disepakati tim, (3) kalau belum ada, susun token warna/tipografi/
      spacing yang koheren dulu sebelum styling detail per komponen.
    - Prioritas WAJIB (Critical, tidak bisa ditawar): kontras warna sesuai WCAG, navigasi
      keyboard berfungsi, touch target minimum 44x44px.
    - Prioritas Tinggi: performa render, konsistensi gaya lintas komponen, layout responsif,
      pola navigasi yang familiar bagi user — jangan berinovasi di hal yang harusnya standar.
    - Jangan asumsikan stack UI — deteksi dari dependency project yang sebenarnya
      (package.json/composer.json/dst), sesuaikan pola implementasi dengan stack itu.
`;

    switch (mode) {
      case 'plan':
        return `You are SendaGo AI in PLAN MODE — an elite Principal Software Architect.
${baseDirectives}
Goal: Buat rencana arsitektur dan langkah kerja refactoring / fitur baru secara sistematis.

Formatting Rules for PLAN MODE:
1. Berikan Ringkasan Strategi 2 kalimat.
2. Buat tabel komponen yang terdampak.
3. Bungkus seluruh rencana langkah dalam <sendago_plan> dengan format:
<sendago_plan>
  <step id="1" title="Buka Docker" command="open -a Docker">Buka Docker Desktop di Mac</step>
  <step id="2" title="Install Laravel" command="composer create-project laravel/laravel backend">Inisialisasi backend Laravel</step>
</sendago_plan>
${contextHeader}`;

      case 'claude-code':
      case 'agent':
        return `You are SendaGo AI in CLAUDE CODE AUTONOMOUS AGENT MODE — a world-class principal software engineer operating directly inside the user's workspace (macOS environment).
${baseDirectives}

CLAUDE CODE EXECUTION PROTOCOL & AUTONOMOUS LOOP:
1. AUTONOMOUS REASONING & EXECUTION FLOW:
   - Siklus kerja: [Analyze] -> [Investigasi via Grep/Find/Read] -> [Execute Replace/Edit/Cmd] -> [Observe Output] -> [Iterate / Self-Correct] -> [Complete].
   - JANGAN hanya berbicara atau memberi saran manual. JALANKAN LANGSUNG via tag tool resmi!
   - Gunakan <sendago_grep> dan <sendago_find> jika belum yakin letak file atau definisi fungsi.
   - Gunakan <sendago_replace> untuk mengubah file yang sudah ada (jangan rewrite 100% file kecuali file baru).
   - Setiap terminal command di dalam <sendago_cmd> otomatis dijalankan dan outputnya diberikan pada turn berikutnya.

2. SELF-CORRECTION & ACTIVE VERIFICATION (CRITICAL):
   - Selalu verifikasi perubahan Anda (misal run \`npm test\`, \`tsc --noEmit\`, atau \`php artisan test\`).
   - Jika terjadi error, jangan minta maaf — baca pesan error, perbaiki via <sendago_replace>, dan jalankan kembali sampai berhasil 100%.

3. COMPLETION SIGNAL:
   - Ketika tugas selesai dan terverifikasi sempurna, emit:
     <sendago_done summary="Ringkasan jelas apa yang telah diselesaikan dan diverifikasi">
     Penjelasan hasil dan petunjuk pengujian.
     </sendago_done>

4. ATURAN KETAT OUTPUT TOOL (DILARANG MENGULANG / ECHO LOG RAW):
   - Pada iterasi berikutnya, sistem akan memberikan feedback hasil eksekusi tool di bawah tag [Observed Output].
   - DILARANG KERAS meng-copy atau mengulang teks log mentah (stdout/stderr/exit code/[Directive]) ke dalam chat user!
   - Bicaralah langsung kepada user dalam Bahasa Indonesia singkat mengenai langkah berikutnya, lalu emit tag tool berikutnya.
${contextHeader}`;

      case 'chat':
      default:
        return `You are SendaGo AI — an intelligent, concise, and highly effective AI pair programmer with direct terminal execution capabilities.
${baseDirectives}
Goal: Menjawab pertanyaan coding, membuat file, dan memberikan perintah terminal yang dapat langsung dieksekusi user dengan 1 klik.
${contextHeader}`;
    }
  }

  /**
   * Mengekstrak perintah terminal dari teks jawaban AI
   */
  public static parseTerminalCommands(text: string): CommandAction[] {
    const commands: CommandAction[] = [];
    const seen = new Set<string>();

    // 1. Tag resmi <sendago_cmd desc="...">command</sendago_cmd>
    const cmdRegex = /<sendago_cmd(?:\s+desc="([^"]*)")?>([\s\S]*?)<\/sendago_cmd>/gi;
    let match;
    while ((match = cmdRegex.exec(text)) !== null) {
      const cmd = match[2].trim();
      if (cmd && !seen.has(cmd)) {
        seen.add(cmd);
        commands.push({
          command: cmd,
          description: match[1] || 'Execute command'
        });
      }
    }

    // 2. Fallback: Deteksi blok ```bash / ```sh yang berisi perintah penting
    if (commands.length === 0) {
      const bashBlockRegex = /```(?:bash|sh|zsh|shell)\n([\s\S]*?)```/gi;
      let bMatch;
      while ((bMatch = bashBlockRegex.exec(text)) !== null) {
        const raw = bMatch[1].trim();
        // Cek apakah mengandung perintah actionable
        if (
          raw.includes('composer ') ||
          raw.includes('npx ') ||
          raw.includes('npm ') ||
          raw.includes('docker ') ||
          raw.includes('open -a') ||
          raw.includes('php artisan') ||
          raw.includes('yarn ') ||
          raw.includes('pnpm ')
        ) {
          const lines = raw.split('\n').filter(l => !l.startsWith('#') && l.trim().length > 0);
          const executableCmd = lines.join(' && ');
          if (executableCmd && !seen.has(executableCmd)) {
            seen.add(executableCmd);
            commands.push({
              command: executableCmd,
              description: `Run Terminal: ${lines[0].slice(0, 30)}...`
            });
          }
        }
      }
    }

    return commands;
  }

  /**
   * Mengekstrak blok edit file dari teks jawaban AI
   */
  public static parseFileEdits(text: string): FileEditAction[] {
    const edits: FileEditAction[] = [];
    const seenPaths = new Set<string>();

    // 1. Primary Regex: Tag resmi <sendago_edit file="..." desc="...">...</sendago_edit>
    const primaryRegex = /<sendago_edit\s+file="([^"]+)"(?:\s+desc="([^"]*)")?>([\s\S]*?)<\/sendago_edit>/gi;
    let match;

    while ((match = primaryRegex.exec(text)) !== null) {
      const cleanPath = match[1].trim();
      if (!seenPaths.has(cleanPath)) {
        seenPaths.add(cleanPath);
        edits.push({
          filePath: cleanPath,
          description: match[2] || `File: ${cleanPath}`,
          newContent: match[3].replace(/^\n+|\n+$/g, '')
        });
      }
    }

    // 2. Fallback Regex: Jika model menulis "File: filename (path/to/file.ext)" diikuti code block ```
    if (edits.length === 0) {
      const fallbackHeaderRegex = /(?:###?\s*(?:File\s*)?(?:[0-9]+\.?\s*)?(?:[a-zA-Z0-9_\-./]+\s*\()?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\)?|(?:File|Path|Lokasi):\s*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?)\s*\n*```(?:[a-zA-Z0-9_-]*)\n([\s\S]*?)```/gi;
      let fbMatch;
      while ((fbMatch = fallbackHeaderRegex.exec(text)) !== null) {
        const filePath = (fbMatch[1] || fbMatch[2] || '').trim();
        const content = (fbMatch[3] || '').trim();
        if (filePath && content && !seenPaths.has(filePath) && filePath.includes('.')) {
          seenPaths.add(filePath);
          edits.push({
            filePath,
            description: `Auto-Detected File: ${filePath}`,
            newContent: content
          });
        }
      }
    }

    // 3. Fallback Regex 2: Jika model menulis code block dengan format ```html:path/to/file.ext
    if (edits.length === 0) {
      const blockFileRegex = /```(?:[a-zA-Z0-9_-]+)[:\s]+(?:filename=")?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)"?\n([\s\S]*?)```/gi;
      let bfMatch;
      while ((bfMatch = blockFileRegex.exec(text)) !== null) {
        const filePath = (bfMatch[1] || '').trim();
        const content = (bfMatch[2] || '').trim();
        if (filePath && content && !seenPaths.has(filePath) && filePath.includes('.')) {
          seenPaths.add(filePath);
          edits.push({
            filePath,
            description: `File: ${filePath}`,
            newContent: content
          });
        }
      }
    }

    return edits;
  }

  /**
   * Mengekstrak langkah rencana kerja dari teks jawaban AI
   */
  public static parsePlanSteps(text: string): PlanStep[] {
    const steps: PlanStep[] = [];
    const planBlockMatch = /<sendago_plan>([\s\S]*?)<\/sendago_plan>/i.exec(text);
    if (!planBlockMatch) return steps;

    const stepRegex = /<step\s+id="([^"]+)"\s+title="([^"]+)"(?:\s+command="([^"]*)")?>([\s\S]*?)<\/step>/gi;
    let match;

    while ((match = stepRegex.exec(planBlockMatch[1])) !== null) {
      steps.push({
        id: parseInt(match[1], 10) || steps.length + 1,
        title: match[2].trim(),
        command: match[3] || undefined,
        description: match[4].trim(),
        completed: false
      });
    }

    return steps;
  }

  /**
   * Mengekstrak permintaan pembuatan gambar AI dari teks jawaban
   */
  public static parseImageActions(text: string): ImageAction[] {
    const images: ImageAction[] = [];
    const seenPaths = new Set<string>();

    // Tag lengkap ditangkap dulu (atribut dalam urutan APAPUN), baru masing-masing
    // atribut diparsing terpisah — model bebas menulis file/prompt/width/height/desc
    // dalam urutan apa pun sesuai contoh di system prompt.
    const imgTagRegex = /<sendago_image\s+([^>]*?)\/?>(?:[\s\S]*?<\/sendago_image>)?/gi;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;

    while ((match = imgTagRegex.exec(text)) !== null) {
      const attrs: Record<string, string> = {};
      let attrMatch;
      attrRegex.lastIndex = 0;
      while ((attrMatch = attrRegex.exec(match[1])) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }

      const cleanPath = (attrs.file || '').trim();
      const prompt = (attrs.prompt || '').trim();
      if (!cleanPath || !prompt || seenPaths.has(cleanPath)) continue;

      seenPaths.add(cleanPath);
      images.push({
        filePath: cleanPath,
        prompt,
        description: attrs.desc || `Image: ${cleanPath}`,
        width: parseInt(attrs.width || '1024', 10),
        height: parseInt(attrs.height || '1024', 10)
      });
    }

    return images;
  }

  /**
   * Mengekstrak aksi surgical search-and-replace dari model (<sendago_replace file="...">)
   */
  public static parseFileReplaces(text: string): FileReplaceAction[] {
    const replaces: FileReplaceAction[] = [];
    const seenPaths = new Set<string>();

    // 1. Tag resmi: <sendago_replace file="..." desc="..."> ... </sendago_replace>
    const replaceTagRegex = /<sendago_replace\s+file="([^"]+)"(?:\s+desc="([^"]*)")?>([\s\S]*?)<\/sendago_replace>/gi;
    let match;

    while ((match = replaceTagRegex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const desc = match[2] || `Replace in ${filePath}`;
      const body = match[3];

      // Format A: <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
      const diffMatch = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/.exec(body);
      if (diffMatch) {
        replaces.push({
          filePath,
          searchContent: diffMatch[1],
          replaceContent: diffMatch[2],
          description: desc
        });
        seenPaths.add(filePath);
        continue;
      }

      // Format B: <search> ... </search> ... <replace> ... </replace>
      const xmlSearchMatch = /<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/i.exec(body);
      if (xmlSearchMatch) {
        replaces.push({
          filePath,
          searchContent: xmlSearchMatch[1].replace(/^\r?\n|\r?\n$/g, ''),
          replaceContent: xmlSearchMatch[2].replace(/^\r?\n|\r?\n$/g, ''),
          description: desc
        });
        seenPaths.add(filePath);
      }
    }

    // 2. Fallback: Deteksi blok <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE tanpa tag pembungkus
    if (replaces.length === 0) {
      const fallbackDiffRegex = /(?:(?:File|Path|Lokasi):\s*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?[\s\S]*?)<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/gi;
      let fbMatch;
      while ((fbMatch = fallbackDiffRegex.exec(text)) !== null) {
        const filePath = fbMatch[1].trim();
        if (filePath && !seenPaths.has(filePath)) {
          seenPaths.add(filePath);
          replaces.push({
            filePath,
            searchContent: fbMatch[2],
            replaceContent: fbMatch[3],
            description: `Diff replace: ${filePath}`
          });
        }
      }
    }

    return replaces;
  }

  /**
   * Mengekstrak aksi pencarian teks di workspace (<sendago_grep query="..." include="..." />)
   */
  public static parseGrepActions(text: string): GrepAction[] {
    const actions: GrepAction[] = [];
    const grepRegex = /<sendago_grep\s+([^>]*?)\/?>(?:[\s\S]*?<\/sendago_grep>)?/gi;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;

    while ((match = grepRegex.exec(text)) !== null) {
      const attrs: Record<string, string> = {};
      let attrMatch;
      attrRegex.lastIndex = 0;
      while ((attrMatch = attrRegex.exec(match[1])) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }

      const query = (attrs.query || attrs.pattern || '').trim();
      if (!query) continue;

      actions.push({
        query,
        include: attrs.include || undefined,
        path: attrs.path || undefined,
        isRegex: attrs.regex === 'true'
      });
    }

    return actions;
  }

  /**
   * Mengekstrak aksi pencarian file di workspace (<sendago_find pattern="..." />)
   */
  public static parseFindFilesActions(text: string): FindFilesAction[] {
    const actions: FindFilesAction[] = [];
    const findRegex = /<sendago_find\s+([^>]*?)\/?>(?:[\s\S]*?<\/sendago_find>)?/gi;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;

    while ((match = findRegex.exec(text)) !== null) {
      const attrs: Record<string, string> = {};
      let attrMatch;
      attrRegex.lastIndex = 0;
      while ((attrMatch = attrRegex.exec(match[1])) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }

      const pattern = (attrs.pattern || attrs.glob || attrs.query || '').trim();
      if (!pattern) continue;

      actions.push({
        pattern,
        maxResults: attrs.max ? parseInt(attrs.max, 10) : undefined
      });
    }

    return actions;
  }

  /**
   * Mengekstrak aksi pembacaan file dari model (<sendago_read file="..." start="..." end="..."/>)
   */
  public static parseReadFileActions(text: string): ReadFileAction[] {
    const actions: ReadFileAction[] = [];
    const seen = new Set<string>();
    const regex = /<sendago_read\s+([^>]*?)\/?>(?:[\s\S]*?<\/sendago_read>)?/gi;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const attrs: Record<string, string> = {};
      let attrMatch;
      attrRegex.lastIndex = 0;
      while ((attrMatch = attrRegex.exec(match[1])) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }

      const file = (attrs.file || attrs.path || '').trim();
      if (!file) continue;

      const key = `${file}:${attrs.start || ''}:${attrs.end || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({
          filePath: file,
          startLine: attrs.start || attrs.startLine ? parseInt(attrs.start || attrs.startLine, 10) : undefined,
          endLine: attrs.end || attrs.endLine ? parseInt(attrs.end || attrs.endLine, 10) : undefined
        });
      }
    }
    return actions;
  }

  /**
   * Mengekstrak sinyal penyelesaian tugas dari model (<sendago_done summary="...">...</sendago_done>)
   */
  public static parseTaskDone(text: string): TaskDoneAction | null {
    const match = /<sendago_done(?:\s+summary="([^"]*)")?>([\s\S]*?)<\/sendago_done>/i.exec(text);
    if (match) {
      return {
        summary: match[1] || match[2].trim() || 'Semua langkah tugas telah selesai dan diverifikasi.'
      };
    }
    return null;
  }

  /**
   * Mengubah tool_calls terstruktur (native function-calling) dari provider menjadi
   * action internal yang sama persis bentuknya dengan hasil parseFileEdits/parseFileReplaces/dst
   * di atas — supaya sidebarProvider.ts bisa mengeksekusi kedua jalur (native & tag-fallback)
   * lewat kode eksekusi yang sama. Setiap action ditandai `toolCallId` agar hasil eksekusinya
   * bisa dikirim balik sebagai pesan `role: 'tool'` yang tertaut ke tool_call yang benar.
   */
  public static buildActionsFromToolCalls(rawToolCalls: ToolCallData[]): {
    edits: FileEditAction[];
    replaces: FileReplaceAction[];
    greps: GrepAction[];
    finds: FindFilesAction[];
    reads: ReadFileAction[];
    commands: CommandAction[];
    images: ImageAction[];
    done: TaskDoneAction | null;
    planSteps: PlanStep[];
  } {
    const edits: FileEditAction[] = [];
    const replaces: FileReplaceAction[] = [];
    const greps: GrepAction[] = [];
    const finds: FindFilesAction[] = [];
    const reads: ReadFileAction[] = [];
    const commands: CommandAction[] = [];
    const images: ImageAction[] = [];
    let done: TaskDoneAction | null = null;
    let planSteps: PlanStep[] = [];

    for (const tc of rawToolCalls) {
      let args: any = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Argumen JSON tidak lengkap/rusak (mis. stream terputus) — lewati tool_call ini,
        // hasil eksekusinya tetap akan mendapat tool-result fallback di sidebarProvider.
        continue;
      }

      switch (tc.function.name) {
        case 'run_command':
          if (args.command) commands.push({ command: String(args.command), description: args.description, toolCallId: tc.id });
          break;
        case 'edit_file':
          if (args.file && typeof args.content === 'string') {
            edits.push({ filePath: String(args.file), newContent: args.content, description: args.description, toolCallId: tc.id });
          }
          break;
        case 'replace_in_file':
          if (args.file && typeof args.search === 'string') {
            replaces.push({ filePath: String(args.file), searchContent: args.search, replaceContent: String(args.replace ?? ''), description: args.description, toolCallId: tc.id });
          }
          break;
        case 'grep_workspace':
          if (args.query) greps.push({ query: String(args.query), isRegex: !!args.isRegex, include: args.include, path: args.path, toolCallId: tc.id });
          break;
        case 'find_files':
          if (args.pattern) finds.push({ pattern: String(args.pattern), maxResults: args.maxResults, toolCallId: tc.id });
          break;
        case 'read_file':
          if (args.file) reads.push({ filePath: String(args.file), startLine: args.startLine, endLine: args.endLine, toolCallId: tc.id });
          break;
        case 'generate_image':
          if (args.file && args.prompt) {
            images.push({ filePath: String(args.file), prompt: String(args.prompt), width: args.width, height: args.height, description: args.description, toolCallId: tc.id });
          }
          break;
        case 'task_done':
          done = { summary: args.summary || 'Tugas selesai dan diverifikasi.', toolCallId: tc.id };
          break;
        case 'create_plan':
          if (Array.isArray(args.steps)) {
            planSteps = args.steps.map((s: any, idx: number) => ({
              id: typeof s.id === 'number' ? s.id : idx + 1,
              title: String(s.title || `Step ${idx + 1}`),
              description: s.description,
              command: s.command,
              completed: false
            }));
          }
          break;
      }
    }

    return { edits, replaces, greps, finds, reads, commands, images, done, planSteps };
  }
}
