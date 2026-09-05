/**
 * Skema tool (OpenAI-compatible `tools`/function-calling format) untuk aksi yang sama
 * persis dengan tag <sendago_*> di agentEngine.ts. Ini bagian dari pendekatan HYBRID:
 * kalau model/provider di balik 9Router mendukung native tool-calling, ia akan
 * memanggil salah satu fungsi ini secara terstruktur alih-alih menulis tag teks.
 * Model yang tidak mendukungnya akan mengabaikan field `tools` dan tetap memakai
 * tag teks sesuai instruksi system prompt — kedua jalur ditangani di sidebarProvider.ts.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

const RUN_COMMAND: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_command',
    description: 'Jalankan satu perintah shell/terminal di root workspace aktif (macOS/zsh). Gunakan untuk install dependency, menjalankan test/build, git, atau dev server.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Perintah shell lengkap yang akan dieksekusi.' },
        description: { type: 'string', description: 'Penjelasan singkat tujuan perintah ini.' }
      },
      required: ['command']
    }
  }
};

const EDIT_FILE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'Buat file baru dari nol, atau tulis ulang 100% isi file yang sudah ada. Untuk perubahan kecil pada file yang sudah ada, PREFER replace_in_file agar hemat token dan tidak merusak baris lain.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path file relatif terhadap root workspace.' },
        content: { type: 'string', description: 'Isi lengkap file setelah perubahan.' },
        description: { type: 'string' }
      },
      required: ['file', 'content']
    }
  }
};

const REPLACE_IN_FILE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'replace_in_file',
    description: 'Surgical search-and-replace pada file yang sudah ada — cara UTAMA untuk mengedit file eksis. "search" harus persis sama dan unik di dalam file.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        search: { type: 'string', description: 'Cuplikan kode lama yang persis ada di file (harus unik, sertakan beberapa baris konteks jika perlu).' },
        replace: { type: 'string', description: 'Cuplikan kode baru pengganti.' },
        description: { type: 'string' }
      },
      required: ['file', 'search', 'replace']
    }
  }
};

const GREP_WORKSPACE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'grep_workspace',
    description: 'Cari teks/regex di seluruh file workspace (seperti ripgrep) untuk menemukan simbol, fungsi, atau kata kunci.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        isRegex: { type: 'boolean' },
        include: { type: 'string', description: 'Glob filter ekstensi, misal "*.ts,*.php".' },
        path: { type: 'string', description: 'Batasi pencarian ke folder/workspace tertentu.' }
      },
      required: ['query']
    }
  }
};

const FIND_FILES: ToolDefinition = {
  type: 'function',
  function: {
    name: 'find_files',
    description: 'Cari file berdasarkan pola nama/glob di seluruh workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        maxResults: { type: 'number' }
      },
      required: ['pattern']
    }
  }
};

const READ_FILE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Baca isi file di workspace, opsional dengan range baris tertentu untuk file besar.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        startLine: { type: 'number' },
        endLine: { type: 'number' }
      },
      required: ['file']
    }
  }
};

const GENERATE_IMAGE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: 'Ajukan permintaan generate gambar AI untuk disimpan ke workspace. Akan ditampilkan sebagai kartu konfirmasi ke user (tidak auto-generate).',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        prompt: { type: 'string', description: 'Prompt visual detail dalam bahasa Inggris.' },
        width: { type: 'number' },
        height: { type: 'number' },
        description: { type: 'string' }
      },
      required: ['file', 'prompt']
    }
  }
};

const TASK_DONE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_done',
    description: 'Panggil ini HANYA ketika seluruh tugas sudah selesai dan sudah diverifikasi (misal test/build berhasil). Mengakhiri autonomous loop.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Ringkasan jelas apa yang telah diselesaikan dan diverifikasi.' }
      },
      required: ['summary']
    }
  }
};

const CREATE_PLAN: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_plan',
    description: 'Susun rencana kerja terstruktur berupa daftar langkah (dipakai di Plan Mode).',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              title: { type: 'string' },
              description: { type: 'string' },
              command: { type: 'string' }
            },
            required: ['title']
          }
        }
      },
      required: ['steps']
    }
  }
};

const AGENT_TOOLS: ToolDefinition[] = [
  RUN_COMMAND, EDIT_FILE, REPLACE_IN_FILE, GREP_WORKSPACE, FIND_FILES, READ_FILE, GENERATE_IMAGE, TASK_DONE
];

const PLAN_TOOLS: ToolDefinition[] = [CREATE_PLAN];

/**
 * Subset TANPA kemampuan mengubah apa pun — cuma baca & sinyal selesai. Dipakai saat
 * langkah eksplorasi dialihkan ke model murah (token saver): model murah secara struktural
 * tidak diberi tool tulis/eksekusi, jadi mustahil dia yang menulis kode. Kalau ternyata
 * langkahnya sudah waktunya menulis, sidebarProvider mendeteksinya dan mengulang langkah
 * itu dengan model utama (lihat streamStepWithModelRotation).
 */
const READ_ONLY_TOOLS: ToolDefinition[] = [GREP_WORKSPACE, FIND_FILES, READ_FILE, TASK_DONE];

export function getToolDefinitionsForMode(mode: string): ToolDefinition[] {
  return mode === 'plan' ? PLAN_TOOLS : AGENT_TOOLS;
}

export function getReadOnlyToolDefinitionsForMode(mode: string): ToolDefinition[] {
  return mode === 'plan' ? PLAN_TOOLS : READ_ONLY_TOOLS;
}
