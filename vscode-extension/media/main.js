// @ts-nocheck
const vscode = acquireVsCodeApi();

// DOM Elements
const messagesContainer = document.getElementById('messages');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('btn-send');
const btnCmdPopup = document.getElementById('btn-cmd-popup');
const btnMentionPopup = document.getElementById('btn-mention-popup');
const btnAttach = document.getElementById('btn-attach');
const btnModeQuick = document.getElementById('btn-mode-quick');
const modeQuickText = document.getElementById('mode-quick-text');

// Claude Code Model Pill & Popover
const btnModelPill = document.getElementById('btn-model-pill');
const modelPillName = document.getElementById('model-pill-name');
const modelPopover = document.getElementById('model-popover');

// Claude Code Auto Mode Card & Empty State
const autoModeCard = document.getElementById('auto-mode-card');
const btnCloseAmCard = document.getElementById('btn-close-am-card');
const amCardTitle = document.getElementById('am-card-title');
const amCardDesc = document.getElementById('am-card-desc');

const slashMenu = document.getElementById('slash-menu');
const mentionMenu = document.getElementById('mention-menu');
const activeFilePill = document.getElementById('active-file-pill');
const activeFileName = document.getElementById('active-file-name');
const btnAddActiveFile = document.getElementById('btn-add-active-file');
const attachmentsBar = document.getElementById('attachments-bar');

const poolSelect = document.getElementById('pool-select');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const projectBadge = document.getElementById('project-badge');
const projectName = document.getElementById('project-name');
const gitBadge = document.getElementById('git-badge');
const gitBranch = document.getElementById('git-branch');
const lspBadge = document.getElementById('lsp-badge');
const lspCount = document.getElementById('lsp-count');
const sendagoBadge = document.getElementById('sendago-badge');

const btnSessions = document.getElementById('btn-sessions');
const sessionsBadge = document.getElementById('sessions-badge');
const btnNewChat = document.getElementById('btn-new-chat');
const sessionsDrawer = document.getElementById('sessions-drawer');
const drawerBtnNew = document.getElementById('drawer-btn-new');
const drawerBtnClose = document.getElementById('drawer-btn-close');
const sessionsList = document.getElementById('sessions-list');

const actionsPanel = document.getElementById('actions-panel');
const modeTabs = document.querySelectorAll('.seg-btn');
const agentLoopPill = document.getElementById('agent-loop-pill');
const agentStepText = document.getElementById('agent-step-text');
const btnStopLoop = document.getElementById('btn-stop-loop');

// State Variables
let currentAssistantBubble = null;
// Wadah "jalur aktivitas" yang menyambungkan terminal block/toast/badge antar satu bubble
// jawaban dengan bubble berikutnya (garis penghubung + jarak rapat via CSS .agent-timeline),
// alih-alih kotak-kotak lepas dengan gap besar — dibuat lazily & di-reset tiap bubble baru
// (lihat createAssistantMessage) supaya urutannya selalu benar di DOM.
let currentTimelineContainer = null;
let currentMode = 'claude-code';
let currentAttachments = []; // Array of { name, path, content }
let isGenerating = false;
let autoMode = true; // true = auto-execute, false = manual confirmation
let permissionMode = 'ask'; // 'auto' | 'ask' | 'plan-only' — nilai efektif dari server
let permissionModeProjectEnforced = false; // true kalau dipaksa .sendago/settings.json
let activeFileObj = null; // { name, path, lines }
const activeTerminalBlocks = new Map(); // termId -> { elem, stdoutElem, statusBadge }
const pendingCommandRequests = new Map();
const pendingImageRequests = new Map();
const pendingEditRequests = new Map();
const pendingReplaceRequests = new Map();
const pendingApplyAllRequests = new Map();

// Autocomplete State
let slashIndex = 0;
let mentionIndex = 0;
let currentMentionFiles = [];

const SLASH_COMMANDS = [
  { cmd: '/fix-errors', icon: '🔴', desc: 'Scan & perbaiki semua error TypeScript / LSP otonom' },
  { cmd: '/git-diff', icon: '🌿', desc: 'Review perubahan git yang belum di-commit' },
  { cmd: '/commit', icon: '💬', desc: 'Generate pesan conventional commit otomatis' },
  { cmd: '/compact', icon: '📦', desc: 'Ringkas percakapan untuk hemat context window' },
  { cmd: '/init', icon: '📝', desc: 'Inisialisasi panduan SENDAGO.md untuk projek' },
  { cmd: '/permissions', icon: '🔒', desc: 'Kebijakan permission proyek (.sendago/settings.json)' },
  { cmd: '/clear', icon: '🗑️', desc: 'Bersihkan chat & mulai percakapan baru' },
  { cmd: '/help', icon: '❓', desc: 'Panduan lengkap fitur Claude Code' }
];

const MODEL_NAMES = {
  'pro': 'Claude Pro',
  'claude-sonnet-5-fusion': 'Sonnet 5 High',
  'hybrid': 'Hybrid',
  'free': 'Free Tier'
};

// Maskot SendaGo dipakai sebagai indikator "sedang bekerja" di semua titik tunggu
// (menyusun jawaban, menulis file, menjalankan perintah) — menggantikan titik abu-abu
// statis yang bikin UI terlihat diam padahal prosesnya masih jalan. Tiap pose adalah file
// terpisah hasil potong sprite sheet maskot.png (media/mascot/mascot-NN.png).
const MASCOT_DIR = document.body?.dataset?.mascotDir || '';

function mascotSrc(pose) {
  if (!MASCOT_DIR) return '';
  return `${MASCOT_DIR}/mascot-${String(pose).padStart(2, '0')}.png`;
}

function mascotHtml(sizeClass, pose) {
  const src = mascotSrc(pose || 1);
  if (!src) {
    // Kalau URI maskot tidak tersedia, jatuh ke titik shimmer lama supaya tetap ada
    // tanda hidup — jangan sampai malah tidak ada indikator sama sekali.
    return '<div class="claude-shimmer-dot"></div>';
  }
  return `<img src="${src}" class="sendago-mascot ${sizeClass || ''}" alt="" aria-hidden="true">`;
}

function mascotLoaderHtml(text, pose) {
  return `
    <div class="claude-loader">
      ${mascotHtml('', pose)}
      <span class="claude-loader-text">${escapeHtml(text || '')}</span>
    </div>
  `;
}

// Auto-scroll pintar: HANYA ikut ke bawah kalau viewport memang sudah dekat bawah.
// Dulu setiap toast/terminal-block/chunk baru langsung memaksa scroll ke paling bawah —
// akibatnya, prompt yang BARU SAJA dikirim user (biasanya masih terlihat di dekat bawah
// saat itu) langsung tergusur ke luar layar begitu respons/tool-call mulai mengisi ke
// bawahnya, padahal user justru ingin melihat prompt-nya sendiri sambil membaca respons
// yang mengalir (perilaku umum di ChatGPT/Claude.ai: prompt "menempel" di atas viewport).
function isViewportNearBottom() {
  const threshold = 96; // px toleransi
  return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold;
}

// AKAR MASALAH "prompt selalu nempel di bawah" yang berulang kali gagal diperbaiki:
// bukan soal race condition timing, tapi keterbatasan fisik scroll. Browser hanya bisa
// scroll sampai `scrollHeight - clientHeight`. Pesan yang baru dikirim itu elemen PALING
// BAWAH, jadi berapa kali pun kita panggil scrollIntoView({block:'start'}), dia tidak
// mungkin naik ke atas viewport — tidak ada konten di bawahnya yang bisa mengisi layar.
// Solusi yang dipakai ChatGPT/Claude.ai: sisipkan spacer kosong di paling bawah supaya
// ada ruang scroll, lalu susutkan spacer itu seiring jawaban mengisi ruang tersebut.
let anchoredMsgElem = null;
const BOTTOM_SPACER_ID = 'sendago-bottom-spacer';

function getBottomSpacer() {
  let spacer = document.getElementById(BOTTOM_SPACER_ID);
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.id = BOTTOM_SPACER_ID;
    spacer.className = 'chat-bottom-spacer';
    spacer.style.height = '0px';
  }
  // Elemen lain (timeline/bubble/toast) di-append belakangan, jadi spacer harus
  // dikembalikan ke posisi terakhir setiap kali dipakai.
  if (messagesContainer.lastElementChild !== spacer) {
    messagesContainer.appendChild(spacer);
  }
  return spacer;
}

/** Offset sebuah elemen relatif terhadap konten scrollable messagesContainer. */
function offsetWithinMessages(elem) {
  const elemTop = elem.getBoundingClientRect().top;
  const containerTop = messagesContainer.getBoundingClientRect().top;
  return (elemTop - containerTop) + messagesContainer.scrollTop;
}

// Sisakan ruang persis secukupnya supaya pesan yang di-anchor bisa berada di atas viewport,
// lalu susut otomatis begitu jawaban/tool-call mengisi ruang di bawahnya — tidak menyisakan
// area kosong menganga di akhir percakapan.
function updateBottomSpacer() {
  const spacer = getBottomSpacer();
  if (!anchoredMsgElem || !anchoredMsgElem.isConnected) {
    spacer.style.height = '0px';
    return;
  }
  const spacerHeight = spacer.offsetHeight;
  const contentHeight = messagesContainer.scrollHeight - spacerHeight;
  const heightBelowAnchor = contentHeight - offsetWithinMessages(anchoredMsgElem);
  const needed = messagesContainer.clientHeight - heightBelowAnchor - 24;
  spacer.style.height = Math.max(0, needed) + 'px';
}

function scrollAnchorToTop(elem) {
  // Beri jeda lebih panjang: animasi smooth melewati banyak posisi antara, dan tanpa ini
  // listener scroll akan mengira user sedang menggulir manual lalu mematikan auto-follow.
  programmaticScrollUntil = Date.now() + 700;
  messagesContainer.scrollTo({
    top: Math.max(0, offsetWithinMessages(elem) - 8),
    behavior: 'smooth'
  });
}

// "Kunci" anchor aktif selama satu turn — dipasang oleh sendMessage() ke elemen prompt yang
// baru dikirim. Selama terkunci, autoScrollIfNearBottom() TIDAK boleh ikut lompat ke bawah
// sama sekali, apa pun status "near bottom"-nya. Tanpa kunci ini ada race condition nyata:
// chunk pertama dari respons bisa datang SEBELUM requestAnimationFrame di sendMessage()
// sempat menjalankan scrollIntoView, dan begitu itu terjadi, container memang masih
// "near bottom" (baru saja ditambahi 2 elemen) sehingga auto-scroll menang duluan dan
// balik memaksa ke bawah — persis gejala yang dilaporkan: makin panjang percakapan, makin
// besar peluang chunk pertama menang balapan sebelum anchor sempat jalan.
// Ikut turun mengikuti konten terbaru selama user TIDAK sedang menggulir ke atas untuk
// membaca sesuatu. Versi sebelumnya mematikan auto-scroll total selama satu giliran demi
// menjaga anchor prompt — akibatnya user harus scroll manual terus-menerus untuk melihat
// jawaban yang sedang mengalir. Sekarang keduanya jalan bersama: prompt di-anchor ke atas
// saat dikirim, lalu tampilan ikut turun sendiri seiring jawaban tumbuh.
let followBottom = true;
// Scroll yang kita picu sendiri tidak boleh dianggap "user menggulir manual".
let programmaticScrollUntil = 0;

// Sinkronkan followBottom dari posisi scroll yang sebenarnya: begitu user menggulir ke
// atas, auto-scroll berhenti sendiri; begitu dia kembali ke dasar, menyala lagi.
messagesContainer?.addEventListener('scroll', () => {
  if (Date.now() < programmaticScrollUntil) return;
  followBottom = isViewportNearBottom();
});

function scrollMessagesToBottom() {
  programmaticScrollUntil = Date.now() + 150;
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Dipanggil setiap kali ada konten baru masuk (chunk/toast/terminal block/bubble) —
// selalu perbarui spacer dulu supaya ruang scroll menyusut seiring jawaban tumbuh.
function autoScrollIfNearBottom() {
  updateBottomSpacer();
  if (!followBottom) return;
  scrollMessagesToBottom();
}

// Pasang anchor ke pesan yang baru dikirim, siapkan ruang scroll-nya, lalu naikkan ke atas
// viewport. Dijalankan di frame berikutnya supaya tinggi elemen sudah final saat dihitung.
function scheduleAnchorScrollTo(targetElem) {
  anchoredMsgElem = targetElem;
  requestAnimationFrame(() => {
    updateBottomSpacer();
    scrollAnchorToTop(targetElem);
  });
}

// Send/Stop State Toggle
function setGeneratingState(generating) {
  isGenerating = generating;
  if (generating) {
    sendBtn.innerHTML = '⏹';
    sendBtn.classList.add('is-stop');
    sendBtn.title = 'Hentikan respons';
  } else {
    sendBtn.innerHTML = '<span class="send-arrow">↑</span>';
    sendBtn.classList.remove('is-stop');
    sendBtn.title = 'Kirim instruksi (Enter)';
  }
}

// Auto-expand Textarea
promptInput?.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
  handleInputAutocomplete();
});

// Quick Mode Toggle (Auto / Ask)
btnModeQuick?.addEventListener('click', () => {
  if (permissionModeProjectEnforced) {
    // Kebijakan proyek (.sendago/settings.json) mengunci mode ini — toggle personal
    // tidak berlaku sampai kebijakan proyek diubah/dihapus.
    return;
  }
  autoMode = !autoMode;
  updateModeDisplay();
  vscode.postMessage({ type: 'toggleAutoExecute', enabled: autoMode });
});

function updatePermissionModeDisplay(mode, projectEnforced) {
  permissionMode = mode || 'ask';
  permissionModeProjectEnforced = !!projectEnforced;

  if (!btnModeQuick) return;

  if (permissionMode === 'plan-only') {
    // Paksa autoMode false secara eksplisit — kalau tidak, render*Cards() akan lolos
    // lewat cabang `if (autoMode)`-nya duluan (yang MEMICU eksekusi otomatis) sebelum
    // sempat mengecek permissionMode sama sekali.
    autoMode = false;
    btnModeQuick.className = 'auto-mode-toggle';
    btnModeQuick.disabled = true;
    btnModeQuick.title = 'Plan-Only Mode dikunci oleh kebijakan proyek (.sendago/settings.json) — eksekusi dinonaktifkan total.';
    if (modeQuickText) modeQuickText.textContent = '🔒 Plan-Only';
  } else {
    btnModeQuick.disabled = false;
    autoMode = permissionMode === 'auto';
    updateModeDisplay();
    if (permissionModeProjectEnforced) {
      btnModeQuick.title += ' (dikunci oleh kebijakan proyek)';
    }
  }
}

function updateModeDisplay() {
  if (autoMode) {
    if (btnModeQuick) {
      btnModeQuick.className = 'auto-mode-toggle active';
      btnModeQuick.title = 'Mode Auto: Perintah aman & edit file langsung dieksekusi';
    }
    if (modeQuickText) modeQuickText.textContent = 'Auto';
    if (amCardTitle) amCardTitle.textContent = 'Mode Otomatis Aktif';
    if (amCardDesc) amCardDesc.textContent = 'Mode Auto memungkinkan SendaGo menangani izin aksi secara otomatis. SendaGo memeriksa setiap tool call untuk tindakan berisiko sebelum dieksekusi, menjalankan tugas aman secara mandiri, dan meminta persetujuan untuk tindakan berisiko tinggi.';
  } else {
    if (btnModeQuick) {
      btnModeQuick.className = 'auto-mode-toggle';
      btnModeQuick.title = 'Mode Ask: Konfirmasi interaktif ditampilkan sebelum eksekusi';
    }
    if (modeQuickText) modeQuickText.textContent = 'Ask';
    if (amCardTitle) amCardTitle.textContent = 'Mode Manual (Ask) Aktif';
    if (amCardDesc) amCardDesc.textContent = 'Mode Ask akan selalu meminta konfirmasi Anda di chat sebelum mengedit berkas atau menjalankan perintah terminal.';
  }
}

// Dismiss Auto Mode Card
btnCloseAmCard?.addEventListener('click', () => {
  const card = document.getElementById('auto-mode-card');
  if (card) card.style.display = 'none';
});

// Model Pill & Popover Interactions
btnModelPill?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = modelPopover && modelPopover.style.display === 'flex';
  if (modelPopover) modelPopover.style.display = isVisible ? 'none' : 'flex';
});

document.addEventListener('click', (e) => {
  if (modelPopover && !modelPopover.contains(e.target) && e.target !== btnModelPill) {
    modelPopover.style.display = 'none';
  }
});

document.querySelectorAll('.popover-item').forEach(item => {
  item.addEventListener('click', () => {
    const val = item.dataset.value;
    if (val) {
      if (poolSelect) poolSelect.value = val;
      updateSelectedModelDisplay(val);
      vscode.postMessage({ type: 'setPool', pool: val });
    }
    if (modelPopover) modelPopover.style.display = 'none';
  });
});

function updateSelectedModelDisplay(poolVal) {
  const label = MODEL_NAMES[poolVal] || poolVal;
  if (modelPillName) modelPillName.textContent = label;
  document.querySelectorAll('.popover-item').forEach(pi => {
    pi.classList.toggle('selected', pi.dataset.value === poolVal);
  });
}

// Mode Switcher Sync
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentMode = tab.dataset.mode;
    vscode.postMessage({ type: 'setMode', mode: currentMode });
  });
});

// Autocomplete Menu Handling
function handleInputAutocomplete() {
  const text = promptInput.value;
  const cursor = promptInput.selectionStart;
  const beforeCursor = text.slice(0, cursor);

  // Slash commands trigger
  if (beforeCursor.startsWith('/')) {
    const query = beforeCursor.slice(1).toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(query) || c.desc.toLowerCase().includes(query));
    renderSlashMenu(filtered);
    return;
  } else {
    hideSlashMenu();
  }

  // @mention files trigger
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex !== -1 && (atIndex === 0 || /\s/.test(beforeCursor[atIndex - 1]))) {
    const query = beforeCursor.slice(atIndex + 1);
    vscode.postMessage({ type: 'searchMentionFiles', query });
    return;
  } else {
    hideMentionMenu();
  }
}

function renderSlashMenu(commands) {
  if (!commands || commands.length === 0) {
    hideSlashMenu();
    return;
  }
  slashIndex = 0;
  slashMenu.innerHTML = commands.map((c, idx) => `
    <div class="ac-item ${idx === 0 ? 'selected' : ''}" data-cmd="${c.cmd}">
      <div class="ac-left">
        <span class="ac-icon">${c.icon}</span>
        <span class="ac-label">${c.cmd}</span>
      </div>
      <span class="ac-desc">${escapeHtml(c.desc)}</span>
    </div>
  `).join('');

  slashMenu.style.display = 'block';
  slashMenu.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      executeSlashCommand(item.dataset.cmd);
    });
  });
}

function hideSlashMenu() {
  if (slashMenu) slashMenu.style.display = 'none';
}

function executeSlashCommand(cmd) {
  hideSlashMenu();
  promptInput.value = '';
  promptInput.style.height = 'auto';
  vscode.postMessage({ type: 'runSlashCommand', command: cmd });
}

function renderMentionMenu(files) {
  currentMentionFiles = files || [];
  if (currentMentionFiles.length === 0) {
    hideMentionMenu();
    return;
  }
  mentionIndex = 0;
  mentionMenu.innerHTML = currentMentionFiles.map((f, idx) => `
    <div class="ac-item ${idx === 0 ? 'selected' : ''}" data-path="${escapeHtml(f.fullPath)}" data-name="${escapeHtml(f.name)}">
      <div class="ac-left">
        <span class="ac-icon">📄</span>
        <span class="ac-label">${escapeHtml(f.name)}</span>
      </div>
      <span class="ac-desc">${escapeHtml(f.relativePath)}</span>
    </div>
  `).join('');

  mentionMenu.style.display = 'block';
  mentionMenu.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      selectMentionFile(item.dataset.path);
    });
  });
}

function hideMentionMenu() {
  if (mentionMenu) mentionMenu.style.display = 'none';
}

function selectMentionFile(filePath) {
  hideMentionMenu();
  // Hapus karakter @query dari input
  const text = promptInput.value;
  const cursor = promptInput.selectionStart;
  const atIndex = text.lastIndexOf('@', cursor);
  if (atIndex !== -1) {
    promptInput.value = text.slice(0, atIndex) + text.slice(cursor);
  }
  vscode.postMessage({ type: 'attachFileByPath', filePath });
}

// Keyboard Navigation inside Textarea
promptInput.addEventListener('keydown', (e) => {
  // Navigate Slash Menu
  if (slashMenu && slashMenu.style.display === 'block') {
    const items = slashMenu.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashIndex = (slashIndex + 1) % items.length;
      updateSelectedAcItem(items, slashIndex);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashIndex = (slashIndex - 1 + items.length) % items.length;
      updateSelectedAcItem(items, slashIndex);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items[slashIndex]) {
        executeSlashCommand(items[slashIndex].dataset.cmd);
      }
      return;
    }
    if (e.key === 'Escape') {
      hideSlashMenu();
      return;
    }
  }

  // Navigate Mention Menu
  if (mentionMenu && mentionMenu.style.display === 'block') {
    const items = mentionMenu.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionIndex = (mentionIndex + 1) % items.length;
      updateSelectedAcItem(items, mentionIndex);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionIndex = (mentionIndex - 1 + items.length) % items.length;
      updateSelectedAcItem(items, mentionIndex);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items[mentionIndex]) {
        selectMentionFile(items[mentionIndex].dataset.path);
      }
      return;
    }
    if (e.key === 'Escape') {
      hideMentionMenu();
      return;
    }
  }

  // Standard Enter to Send
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (isGenerating) {
      vscode.postMessage({ type: 'stopGeneration' });
    } else {
      sendMessage();
    }
  }
});

function updateSelectedAcItem(items, selectedIndex) {
  items.forEach((it, idx) => {
    it.classList.toggle('selected', idx === selectedIndex);
    if (idx === selectedIndex) {
      it.scrollIntoView({ block: 'nearest' });
    }
  });
}

// Button Triggers for Popups
btnCmdPopup?.addEventListener('click', () => {
  renderSlashMenu(SLASH_COMMANDS);
});

btnMentionPopup?.addEventListener('click', () => {
  vscode.postMessage({ type: 'searchMentionFiles', query: '' });
});

btnAttach?.addEventListener('click', () => {
  vscode.postMessage({ type: 'pickAttachment' });
});

// Quick Action Cards in Welcome Screen
document.querySelectorAll('.quick-action-card').forEach(card => {
  card.addEventListener('click', () => {
    const cmd = card.dataset.cmd;
    if (cmd) executeSlashCommand(cmd);
  });
});

// Sessions Drawer Toggles & Actions
btnSessions?.addEventListener('click', () => {
  const isVisible = sessionsDrawer.style.display === 'flex' || sessionsDrawer.style.display === 'block';
  if (isVisible) {
    sessionsDrawer.style.display = 'none';
  } else {
    sessionsDrawer.style.display = 'flex';
    vscode.postMessage({ type: 'listSessions' });
  }
});

drawerBtnClose?.addEventListener('click', () => {
  sessionsDrawer.style.display = 'none';
});

btnNewChat?.addEventListener('click', () => {
  startNewSession();
});

drawerBtnNew?.addEventListener('click', () => {
  startNewSession();
});

function startNewSession() {
  sessionsDrawer.style.display = 'none';
  anchoredMsgElem = null; // elemen lama ikut terhapus di bawah — jangan sisakan anchor menggantung
  messagesContainer.innerHTML = '';
  actionsPanel.style.display = 'none';
  actionsPanel.innerHTML = '';
  currentAttachments = [];
  renderAttachmentChips();
  vscode.postMessage({ type: 'newSession' });
}

// Stop Loop
btnStopLoop?.addEventListener('click', () => {
  vscode.postMessage({ type: 'stopAutonomousLoop' });
});

// Active File Pill Attach
btnAddActiveFile?.addEventListener('click', () => {
  if (activeFileObj && activeFileObj.path) {
    vscode.postMessage({ type: 'attachFileByPath', filePath: activeFileObj.path });
  }
});

// LSP Pill Click -> Fix Errors
lspBadge?.addEventListener('click', () => {
  executeSlashCommand('/fix-errors');
});

// Attachment Chips Rendering
function renderAttachmentChips() {
  if (!attachmentsBar) return;
  if (currentAttachments.length === 0) {
    attachmentsBar.style.display = 'none';
    attachmentsBar.innerHTML = '';
    return;
  }

  attachmentsBar.style.display = 'flex';
  attachmentsBar.innerHTML = '';

  currentAttachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    chip.innerHTML = `
      <span class="chip-icon">📄</span>
      <span class="chip-name" title="${escapeHtml(att.path)}">${escapeHtml(att.name)}</span>
      <button class="btn-remove-chip" data-idx="${idx}">✕</button>
    `;

    chip.querySelector('.btn-remove-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      currentAttachments.splice(idx, 1);
      renderAttachmentChips();
    });

    attachmentsBar.appendChild(chip);
  });
}

// Send Message
function sendMessage() {
  const text = promptInput.value.trim();
  if (!text && currentAttachments.length === 0) return;

  // Kirim prompt baru = user pasti ingin mengikuti jawabannya, jadi nyalakan lagi
  // auto-follow meski sebelumnya dia sempat menggulir ke atas untuk membaca chat lama.
  followBottom = true;
  // Lepas anchor giliran sebelumnya dulu — kalau tidak, spacer sempat dihitung terhadap
  // pesan lama saat dua fungsi append di bawah dipanggil.
  anchoredMsgElem = null;

  // Hide Claude empty state
  const emptyState = document.getElementById('claude-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  // Clear previous actions panel
  actionsPanel.style.display = 'none';
  actionsPanel.innerHTML = '';

  // Append user bubble
  const userMsgElem = appendUserMessage(text, currentAttachments);

  const attachmentsToSend = [...currentAttachments];
  currentAttachments = [];
  renderAttachmentChips();

  promptInput.value = '';
  promptInput.style.height = 'auto';

  // Create assistant bubble with Claude-style loading indicator
  currentAssistantBubble = createAssistantMessage();
  setGeneratingState(true);

  // Lock sudah aktif sejak awal fungsi ini — sekarang jadwalkan scroll aktualnya ke
  // prompt yang baru dikirim (elemen-nya baru ada setelah appendUserMessage di atas).
  scheduleAnchorScrollTo(userMsgElem);

  vscode.postMessage({
    type: 'prompt',
    text: text,
    pool: poolSelect.value,
    mode: currentMode,
    attachments: attachmentsToSend
  });
}

sendBtn.addEventListener('click', () => {
  if (isGenerating) {
    vscode.postMessage({ type: 'stopGeneration' });
  } else {
    sendMessage();
  }
});

poolSelect?.addEventListener('change', () => {
  updateSelectedModelDisplay(poolSelect.value);
  vscode.postMessage({ type: 'setPool', pool: poolSelect.value });
});

// Health / Status Badge Click -> API Key
statusBadge?.addEventListener('click', () => {
  if (statusBadge.classList.contains('offline')) {
    vscode.postMessage({ type: 'setupApiKey' });
  }
});

// Webview Message Receiver
window.addEventListener('message', (event) => {
  const message = event.data;

  switch (message.type) {
    case 'status':
      updateStatusDisplay(message);
      break;

    case 'activeContextUpdated':
      updateActiveContext(message.activeFile, message.totalErrors, message.totalWarnings);
      break;

    case 'modelsDiscovered':
      // Model spesifik dihilangkan agar dropdown rapi dan fokus pada Claude Pro & Fusion
      break;

    case 'mentionFilesResult':
      renderMentionMenu(message.files);
      break;

    case 'sessionsList':
      renderSessionsList(message.sessions, message.currentSessionId);
      break;

    case 'sessionLoaded':
      loadSessionIntoChat(message.session);
      break;

    case 'newSessionReady':
    case 'sessionCleared':
      resetChatToWelcome();
      break;

    case 'attachmentAdded':
      if (message.file && !currentAttachments.some(a => a.path === message.file.path)) {
        currentAttachments.push(message.file);
        renderAttachmentChips();
      }
      break;

    case 'setPoolValue':
      if (message.pool) {
        if (poolSelect) poolSelect.value = message.pool;
        updateSelectedModelDisplay(message.pool);
      }
      break;

    case 'setAutoExecuteValue':
      autoMode = !!message.enabled;
      updateModeDisplay();
      break;

    case 'setPermissionMode':
      updatePermissionModeDisplay(message.mode, message.projectEnforced);
      break;

    case 'switchMode':
      if (message.mode) {
        modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === message.mode));
        currentMode = message.mode;
      }
      break;

    case 'chunk':
      if (currentAssistantBubble) {
        currentAssistantBubble.rawText += message.text;
        currentAssistantBubble.contentElem.innerHTML = renderCleanChat(currentAssistantBubble.rawText, false);
        // Maskot & labelnya ikut menjelaskan apa yang sedang dikerjakan — begitu model
        // mulai menulis file, kunci ke pose "mengetik di laptop" dengan nama file yang
        // sedang ditulis, alih-alih rotasi teks "berpikir" yang generik.
        const writingFile = detectWritingFileName(currentAssistantBubble.rawText);
        if (writingFile) {
          stopThinkingProgress();
          applyMascotState(
            currentAssistantBubble.workingElem,
            POSE_WRITING_CODE,
            `Sedang menyusun ${getShortPath(writingFile)}...`
          );
        }
        autoScrollIfNearBottom();
      }
      break;

    case 'assistantMessage':
      appendAssistantDirectMessage(message.text);
      break;

    case 'terminalStart':
      renderTerminalBlockStart(message.termId, message.command, message.desc);
      break;

    case 'terminalChunk':
      appendTerminalChunk(message.termId, message.text, message.isStderr);
      break;

    case 'terminalEnd':
      resolveTerminalBlockEnd(message.termId, message.exitCode, message.durationMs, message.timedOut);
      break;

    case 'loopStep':
      handleLoopStep(message.step, message.maxSteps, message.isLoop);
      break;

    case 'startFinalSummary':
      handleStartFinalSummary();
      break;

    case 'resetCurrentBubble':
      // Model yang lagi dicoba drop di tengah stream (fallback ke model lain) — bersihkan
      // teks parsial yang sempat tampil supaya tidak tercampur dengan jawaban model
      // berikutnya yang akan mengisi bubble yang sama.
      if (currentAssistantBubble) resetBubbleToLoading(currentAssistantBubble);
      break;

    case 'taskCompleted':
      handleTaskCompleted(message.summary);
      break;

    case 'dangerousCommandConfirm':
      renderDangerousCommandConfirm(message.requestId, message.command, message.reason);
      break;

    case 'fileReplacesDetected':
      renderFileReplaceCards(message.replaces);
      break;

    case 'filesAutoReplaced':
      if (message.replaces && message.replaces.length > 0) {
        const details = message.replaces.map(r => `${getShortPath(r.file)}${r.line ? ` (L${r.line})` : ''}`).join(', ');
        appendAutoExecToast('✨', `Perbaikan Code: ${details}`);
      }
      break;

    case 'fileEditsDetected':
      renderFileEditCards(message.edits);
      break;

    case 'filesAutoApplied':
      if (message.files && message.files.length > 0) {
        const short = message.files.map(f => getShortPath(f)).join(', ');
        appendAutoExecToast('📄', `File diperbarui otomatis: ${short}`);
      }
      break;

    case 'grepResult':
      appendAutoExecToast('🔍', `Grep: ${message.count} kecocokan untuk "${escapeHtml(message.query)}"`);
      break;

    case 'findResult':
      appendAutoExecToast('📁', `Find: ${message.count} berkas untuk pola "${escapeHtml(message.pattern)}"`);
      break;

    case 'serverStartedToast':
      appendAutoExecToast('⚡', `Dev Server berjalan di terminal: $ ${escapeHtml(message.command)}`);
      break;

    case 'replaceAppliedResult':
      resolveReplaceApplied(message);
      break;

    case 'imagesDetected':
      renderImageCards(message.images);
      break;

    case 'commandsDetected':
      renderCommandCards(message.commands, message.autoApplied);
      break;

    case 'planStepsDetected':
      renderPlanCard(message.steps);
      break;

    case 'commandResult':
      resolvePendingCommandButton(message.requestId, message.ran);
      break;

    case 'imageGenerationResult':
      resolveImageGenerationResult(message);
      break;

    case 'editAppliedResult':
      resolveEditApplied(message);
      break;

    case 'allEditsAppliedResult':
      resolveAllEditsApplied(message);
      break;

    case 'done':
      stopThinkingProgress();
      if (agentLoopPill) agentLoopPill.style.display = 'none';
      finalizeCurrentBubble();
      currentAssistantBubble = null;
      setGeneratingState(false);
      break;

    case 'stopped':
      stopThinkingProgress();
      if (agentLoopPill) agentLoopPill.style.display = 'none';
      if (currentAssistantBubble) {
        currentAssistantBubble.workingElem?.remove();
        currentAssistantBubble.contentElem.innerHTML = renderCleanChat(currentAssistantBubble.rawText, true);
        attachCodeBlockActions(currentAssistantBubble.contentElem);
        currentAssistantBubble.contentElem.innerHTML += `<div class="stopped-badge">⏹ Dihentikan</div>`;
      }
      currentAssistantBubble = null;
      setGeneratingState(false);
      break;

    case 'error':
      stopThinkingProgress();
      if (agentLoopPill) agentLoopPill.style.display = 'none';
      if (currentAssistantBubble) {
        currentAssistantBubble.contentElem.innerHTML += `<div class="error-badge">❌ ${escapeHtml(message.error)}</div>`;
      } else {
        appendErrorMessage(message.error);
      }
      currentAssistantBubble = null;
      setGeneratingState(false);
      break;
  }
});

// UI Status Updates
function updateStatusDisplay(status) {
  if (status.ok) {
    statusBadge.className = 'status-pill online';
    if (statusText) statusText.textContent = `Online (${status.latencyMs}ms)`;
    statusBadge.title = `9Router Gateway aktif — Latensi: ${status.latencyMs}ms`;
  } else {
    statusBadge.className = 'status-pill offline';
    if (statusText) statusText.textContent = 'Offline';
    statusBadge.title = status.error ? `${status.error}\nKlik untuk atur API Key` : 'Klik untuk atur API Key';
  }

  if (status.projectName && projectName) {
    projectName.textContent = status.projectName;
  }

  if (status.gitBranch && gitBadge && gitBranch) {
    gitBadge.style.display = 'flex';
    gitBranch.textContent = status.gitBranch;
  }

  if (lspBadge && lspCount) {
    const errs = status.totalErrors || 0;
    if (errs > 0) {
      lspBadge.style.display = 'flex';
      lspCount.textContent = `${errs} error${errs > 1 ? 's' : ''}`;
    } else {
      lspBadge.style.display = 'none';
    }
  }

  if (sendagoBadge) {
    sendagoBadge.style.display = status.hasSendaGoMd ? 'flex' : 'none';
  }

  if (status.activeFile) {
    updateActiveContext(status.activeFile);
  }
}

function updateActiveContext(activeFile, totalErrors, totalWarnings) {
  activeFileObj = activeFile;
  if (activeFile && activeFile.name && activeFilePill && activeFileName) {
    activeFilePill.style.display = 'inline-flex';
    activeFileName.textContent = `${activeFile.name}:${activeFile.lines || ''}`;
  } else if (activeFilePill) {
    activeFilePill.style.display = 'none';
  }

  if (totalErrors !== undefined && lspBadge && lspCount) {
    if (totalErrors > 0) {
      lspBadge.style.display = 'flex';
      lspCount.textContent = `${totalErrors} error${totalErrors > 1 ? 's' : ''}`;
    } else {
      lspBadge.style.display = 'none';
    }
  }
}

// Sessions Rendering
function renderSessionsList(sessions, currentId) {
  if (sessionsBadge) sessionsBadge.textContent = String(sessions?.length || 0);
  if (!sessionsList) return;

  if (!sessions || sessions.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-empty">Belum ada riwayat sesi tersimpan.</div>';
    return;
  }

  sessionsList.innerHTML = sessions.map(s => {
    const isActive = s.id === currentId;
    const dateStr = formatRelativeTime(s.updatedAt);
    return `
      <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}">
        <div class="session-item-info">
          <span class="session-item-title">${escapeHtml(s.title || 'Untitled Session')}</span>
          <span class="session-item-meta">${dateStr} • ${s.messageCount} pesan</span>
        </div>
        <button class="session-item-delete" data-id="${s.id}" title="Hapus sesi ini">🗑️</button>
      </div>
    `;
  }).join('');

  sessionsList.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.session-item-delete')) return;
      const sid = item.dataset.id;
      sessionsDrawer.style.display = 'none';
      vscode.postMessage({ type: 'loadSession', sessionId: sid });
    });
  });

  sessionsList.querySelectorAll('.session-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = btn.dataset.id;
      vscode.postMessage({ type: 'deleteSession', sessionId: sid });
    });
  });
}

function loadSessionIntoChat(session) {
  anchoredMsgElem = null;
  messagesContainer.innerHTML = '';
  actionsPanel.style.display = 'none';
  actionsPanel.innerHTML = '';

  if (!session.messages || session.messages.length === 0) {
    resetChatToWelcome();
    return;
  }

  session.messages.forEach(m => {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : '';
      if (text.startsWith('[Observed') || text.startsWith('[Tool Execution Result') || text.startsWith('[Files Automatically Applied') || text.startsWith('[Command Skipped')) {
        return;
      }
      appendUserMessage(text);
    } else if (m.role === 'assistant') {
      const cleanHtml = renderCleanChat(m.content || '', true);
      if (!cleanHtml.trim()) return;
      const msg = document.createElement('div');
      msg.className = 'message assistant';
      const content = document.createElement('div');
      content.className = 'message-content';
      content.innerHTML = cleanHtml;
      attachCodeBlockActions(content);
      msg.appendChild(content);
      messagesContainer.appendChild(msg);
    }
  });

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function resetChatToWelcome() {
  anchoredMsgElem = null;
  messagesContainer.innerHTML = `
    <div id="claude-empty-state" class="claude-empty-state">
      <div class="empty-headline">
        Apa yang ingin Anda kerjakan terlebih dahulu? Tanyakan seputar codebase ini atau kita bisa langsung mulai menulis kode.
      </div>

      <div id="auto-mode-card" class="auto-mode-card">
        <div class="am-header">
          <div class="am-title-row">
            <svg class="am-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span id="am-card-title">${autoMode ? 'Mode Otomatis Aktif' : 'Mode Manual (Ask) Aktif'}</span>
          </div>
          <button id="btn-close-am-card" class="am-close-btn" title="Tutup">✕</button>
        </div>
        <p id="am-card-desc" class="am-desc">
          ${autoMode
            ? 'Mode Auto memungkinkan SendaGo menangani izin aksi secara otomatis. SendaGo memeriksa setiap tool call untuk tindakan berisiko sebelum dieksekusi, menjalankan tugas aman secara mandiri, dan meminta persetujuan untuk tindakan berisiko tinggi.'
            : 'Mode Ask akan selalu meminta konfirmasi Anda di chat sebelum mengedit berkas atau menjalankan perintah terminal.'}
        </p>
        <a id="am-learn-more" class="am-link" href="#">Pelajari selengkapnya</a>
      </div>
    </div>
  `;

  document.getElementById('btn-close-am-card')?.addEventListener('click', () => {
    const card = document.getElementById('auto-mode-card');
    if (card) card.style.display = 'none';
  });
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h lalu`;
}

// In-Chat Confirmation for Dangerous Commands
const CONFIRM_REASON_LABELS = {
  'dangerous': '⚠️ Perintah Berisiko Tinggi — Wajib Konfirmasi',
  'unrecognized': '❓ Perintah Belum Dikenali — Konfirmasi Eksekusi',
  'untrusted-workspace': '🔒 Workspace Belum Dipercaya — Konfirmasi Perintah'
};

function renderDangerousCommandConfirm(requestId, command, reason) {
  const headerText = CONFIRM_REASON_LABELS[reason] || CONFIRM_REASON_LABELS.dangerous;
  const card = document.createElement('div');
  card.className = 'inchat-confirm-card';
  card.innerHTML = `
    <div class="inchat-confirm-header">
      <span>${headerText}</span>
    </div>
    <div class="inchat-confirm-body">
      <code>$ ${escapeHtml(command)}</code>
    </div>
    <div class="inchat-confirm-actions">
      <button class="btn-confirm-skip" data-id="${requestId}">Lewati (Skip)</button>
      <button class="btn-confirm-approve" data-id="${requestId}">Setujui &amp; Jalankan ▶</button>
    </div>
  `;

  card.querySelector('.btn-confirm-approve').addEventListener('click', () => {
    card.remove();
    vscode.postMessage({ type: 'confirmResponse', requestId, confirmed: true });
  });

  card.querySelector('.btn-confirm-skip').addEventListener('click', () => {
    card.remove();
    vscode.postMessage({ type: 'confirmResponse', requestId, confirmed: false });
  });

  messagesContainer.appendChild(card);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Message Bubbles & Rendering
function appendUserMessage(text, attachments) {
  const emptyState = document.getElementById('claude-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  const msg = document.createElement('div');
  msg.className = 'message user';

  let attHtml = '';
  if (attachments && attachments.length > 0) {
    attHtml = `<div class="user-attachments">` +
      attachments.map(a => `<span class="user-att-pill">📎 ${escapeHtml(a.name)}</span>`).join(' ') +
      `</div>`;
  }

  msg.innerHTML = `${attHtml}${escapeHtml(text)}`;
  messagesContainer.appendChild(msg);
  autoScrollIfNearBottom();
  return msg;
}

// Tiap tahap "sedang bekerja" punya pose maskotnya sendiri (hasil potong sprite sheet
// maskot.png). Urutan & teksnya mengikuti kartu di sheet tersebut, jadi pose dan label
// selalu nyambung — bukan satu gambar statis yang diulang untuk semua keadaan.
const MASCOT_STATES = [
  { pose: 1, label: 'Sedang berpikir...' },
  { pose: 2, label: 'Memahami permintaan...' },
  { pose: 3, label: 'Menganalisis informasi...' },
  { pose: 4, label: 'Mencari solusi terbaik...' },
  { pose: 5, label: 'Menyusun jawaban...' },
  { pose: 6, label: 'Mengolah informasi...' },
  { pose: 7, label: 'Memeriksa kembali...' },
  { pose: 8, label: 'Menyempurnakan jawaban...' },
  { pose: 10, label: 'Menyiapkan jawaban...' },
  { pose: 11, label: 'Sedang memproses...' },
  { pose: 9, label: 'Hampir selesai...' }
];

// Pose khusus untuk keadaan yang sudah pasti (tidak ikut rotasi).
const POSE_WRITING_CODE = 6;   // maskot dengan laptop
const POSE_RUNNING_CMD = 8;    // maskot memegang gear
const POSE_SUMMARY = 10;       // maskot dengan pesawat kertas
const POSE_DONE = 12;          // maskot dengan centang hijau

const THINKING_MESSAGES = MASCOT_STATES.map(s => s.label);

let thinkingInterval = null;
let currentThinkingIndex = 0;

// Ganti pose + label pada elemen "sedang bekerja" milik satu bubble. `src` di-set ulang
// pada elemen <img> yang SAMA (bukan bikin elemen baru), jadi animasi CSS-nya tidak
// restart dan maskot tetap terlihat bergerak.
function applyMascotState(workingElem, pose, label) {
  if (!workingElem) return;
  const img = workingElem.querySelector('.sendago-mascot');
  const text = workingElem.querySelector('.claude-loader-text');
  if (img && pose) img.src = mascotSrc(pose);
  if (text && label) text.textContent = label;
}

function startThinkingProgress(loaderTextElem) {
  stopThinkingProgress();
  currentThinkingIndex = 0;
  const workingElem = loaderTextElem?.closest('.message-working, .claude-loader');
  applyMascotState(workingElem, MASCOT_STATES[0].pose, MASCOT_STATES[0].label);

  thinkingInterval = setInterval(() => {
    // Berhenti di state terakhir, jangan memutar balik ke awal — supaya tidak terkesan
    // proses mengulang dari nol padahal sebenarnya masih maju.
    if (currentThinkingIndex >= MASCOT_STATES.length - 1) return;
    currentThinkingIndex++;
    const state = MASCOT_STATES[currentThinkingIndex];
    const text = workingElem?.querySelector('.claude-loader-text');
    if (!text) return;
    text.style.opacity = '0';
    setTimeout(() => {
      applyMascotState(workingElem, state.pose, state.label);
      text.style.opacity = '1';
    }, 180);
  }, 1800);
}

function stopThinkingProgress() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
}

function getActiveThinkingMessage() {
  return THINKING_MESSAGES[Math.min(currentThinkingIndex, THINKING_MESSAGES.length - 1)];
}

// Ambil (atau buat) wadah aktivitas yang sedang aktif untuk terminal block/toast/badge.
// Dipanggil lazily oleh setiap penulis aktivitas — kalau belum ada atau sudah "usang"
// (mis. chat di-reset), bikin baru dan taruh di akhir messagesContainer.
function getOrCreateTimeline() {
  if (!currentTimelineContainer || !currentTimelineContainer.isConnected) {
    currentTimelineContainer = document.createElement('div');
    currentTimelineContainer.className = 'agent-timeline';
    messagesContainer.appendChild(currentTimelineContainer);
  }
  return currentTimelineContainer;
}

// Bungkus satu elemen aktivitas (toast/terminal-block/badge) dengan dot penanda + masukkan
// ke timeline aktif — `status` menentukan warna dot ('running' merah berdenyut, 'success'
// hijau, 'error' merah, atau kosong untuk abu-abu netral). Return wrapper-nya supaya
// pemanggil bisa update status belakangan (mis. terminal block: running -> success/error).
function appendTimelineNode(el, status) {
  const wrapper = document.createElement('div');
  wrapper.className = `timeline-node${status ? ' ' + status : ''}`;
  wrapper.appendChild(el);
  getOrCreateTimeline().appendChild(wrapper);
  return wrapper;
}

function createAssistantMessage() {
  const emptyState = document.getElementById('claude-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  // CATATAN: timeline TIDAK di-reset di sini (beda dari versi sebelumnya). Banyak model,
  // terutama lewat native tool-calling, mengerjakan SATU aksi per giliran tanpa narasi teks
  // sama sekali — kalau timeline direset tiap bubble baru dibuat, tiap toast/terminal block
  // berakhir sendirian di wadahnya masing-masing dan garis penghubungnya jadi tidak kelihatan
  // gunanya (grup isi 1 = tidak ada apa-apa yang perlu disambung). Timeline baru direset di
  // finalizeCurrentBubble() — dan HANYA kalau bubble yang baru selesai itu benar-benar berisi
  // teks. Bubble yang kosong (murni tool call) langsung dibuang dari DOM di sana, dan
  // aktivitas berikutnya tetap menyambung ke timeline yang sama — jadi satu alur visual utuh
  // sepanjang task, persis seperti timeline Claude Code.
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  const content = document.createElement('div');
  content.className = 'message-content';

  // Indikator "sedang bekerja" sengaja jadi elemen TERPISAH & PERMANEN, bukan bagian dari
  // contentElem. contentElem ditulis ulang setiap chunk masuk (bisa puluhan kali per detik);
  // kalau maskot ikut di dalamnya, elemen <img>-nya dibuat ulang terus dan animasinya
  // restart dari frame nol setiap kali — hasilnya maskot justru terlihat beku, kebalikan
  // dari yang diinginkan.
  const working = document.createElement('div');
  working.className = 'message-working';
  working.innerHTML = mascotLoaderHtml(THINKING_MESSAGES[0]);

  msg.appendChild(content);
  msg.appendChild(working);
  messagesContainer.appendChild(msg);
  autoScrollIfNearBottom();

  const bubble = {
    elem: msg,
    contentElem: content,
    workingElem: working,
    rawText: '',
    loaderTextElem: working.querySelector('.claude-loader-text')
  };
  startThinkingProgress(bubble.loaderTextElem);
  return bubble;
}

// Kembalikan sebuah bubble ke tampilan loading awal — dipakai saat model pertama drop di
// tengah stream dan sistem otomatis mencoba model fallback berikutnya, supaya teks parsial
// dari model yang gagal tidak tercampur dengan jawaban model berikutnya di bubble yang sama.
// Elemen maskot TIDAK dibuat ulang di sini, cuma teksnya yang direset — animasinya jalan terus.
function resetBubbleToLoading(bubble) {
  bubble.rawText = '';
  bubble.contentElem.innerHTML = '';
  if (bubble.workingElem) bubble.workingElem.style.display = '';
  if (bubble.loaderTextElem) bubble.loaderTextElem.textContent = THINKING_MESSAGES[0];
  startThinkingProgress(bubble.loaderTextElem);
}


function appendAssistantDirectMessage(markdownText) {
  const emptyState = document.getElementById('claude-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  const msg = document.createElement('div');
  msg.className = 'message assistant';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = renderCleanChat(markdownText, true);
  attachCodeBlockActions(content);
  msg.appendChild(content);
  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendErrorMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  msg.innerHTML = `<div class="error-badge">❌ ${escapeHtml(text)}</div>`;
  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attachCodeBlockActions(container) {
  container.querySelectorAll('.btn-copy-code').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (code) {
        navigator.clipboard.writeText(code);
        btn.innerText = 'Copied!';
        setTimeout(() => { btn.innerText = 'Copy'; }, 2000);
      }
    });
  });

  container.querySelectorAll('.btn-insert-code').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (code) {
        vscode.postMessage({ type: 'insertCode', code });
        btn.innerText = 'Inserted ✔';
        setTimeout(() => { btn.innerText = '⏎ Insert'; }, 2000);
      }
    });
  });

  container.querySelectorAll('.btn-run-code').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (code) {
        requestRunCommand(code, btn, () => {
          setTimeout(() => {
            btn.innerText = '▶ Run';
            btn.style.backgroundColor = '';
            btn.style.color = '';
          }, 2500);
        });
      }
    });
  });
}

function renderCleanChat(raw, isDone) {
  if (!raw) return '';
  let text = raw;

  text = text.replace(/<sendago_edit\s+file="([^"]+)"(?:\s+desc="([^"]*)")?>[\s\S]*?(?:<\/sendago_edit>|$)/gi, '');
  text = text.replace(/<sendago_image\s+[^>]*>[\s\S]*?(?:<\/sendago_image>|$)/gi, '');
  text = text.replace(/<sendago_cmd(?:\s+desc="([^"]*)")?>[\s\S]*?(?:<\/sendago_cmd>|$)/gi, '');
  text = text.replace(/<sendago_plan>[\s\S]*?(?:<\/sendago_plan>|$)/gi, '');
  text = text.replace(/<sendago_read\s+file="([^"]+)"\s*\/?>/gi, '');
  text = text.replace(/<sendago_done(?:\s+summary="([^"]*)")?>[\s\S]*?(?:<\/sendago_done>|$)/gi, '');

  // Strip accidental tool output or internal loop directive echoes
  text = text.replace(/\[(?:Tool Execution Result|Observed Command Output|Observed Terminal Execution)[\s\S]*?(?:\[(?:System Feedback|Directive):[\s\S]*?\]|\n\n(?=[A-Z0-9<#*_])|$)/gi, '');
  text = text.replace(/\[(?:System Feedback|Directive):[\s\S]*?\]/gi, '');
  text = text.replace(/\[Files Automatically Applied[\s\S]*?\]/gi, '');

  text = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (m, thought) => {
    return `<details class="think-block"><summary>🧠 ${escapeHtml(getActiveThinkingMessage())}</summary><div class="think-content">${escapeHtml(thought.trim())}</div></details>\n`;
  });

  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || 'text', code });
    return placeholder;
  });

  let html = escapeHtml(text.trim());

  html = html.replace(/^#### (.*?)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^### (.*?)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 class="md-h1">$1</h1>');

  html = html.replace(/^---$/gm, '<hr class="md-hr">');
  html = html.replace(/^&gt;\s*(.*?)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
    const rows = match.trim().split('\n').filter(r => !r.includes('---'));
    if (rows.length === 0) return match;
    let tableHtml = '<table class="md-table">';
    rows.forEach((row, i) => {
      const cols = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      const tag = i === 0 ? 'th' : 'td';
      tableHtml += '<tr>' + cols.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
    });
    tableHtml += '</table>';
    return tableHtml;
  });

  html = html.replace(/^[\s]*[-*•]\s+(.*?)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/((?:<li class="md-li">.*?<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\n\n/g, '<p class="md-p"></p>');
  html = html.replace(/\n/g, '<br>');

  codeBlocks.forEach((cb, idx) => {
    const escapedCode = escapeHtml(cb.code);
    const isShell = ['bash', 'sh', 'zsh', 'shell', 'cmd'].includes(cb.lang.toLowerCase());
    const runBtn = isShell ? `<button class="btn-run-code" data-code="${escapeHtml(cb.code)}">▶ Run</button>` : '';
    const insertBtn = isShell ? '' : `<button class="btn-insert-code" data-code="${escapeHtml(cb.code)}">⏎ Insert</button>`;

    const blockHtml = `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span>${cb.lang}</span>
          <div style="display: flex; gap: 4px;">
            ${runBtn}
            ${insertBtn}
            <button class="btn-copy-code" data-code="${escapeHtml(cb.code)}">Copy</button>
          </div>
        </div>
        <pre><code class="language-${cb.lang}">${escapedCode}</code></pre>
      </div>
    `;
    html = html.replace(`__CODE_BLOCK_${idx}__`, blockHtml);
  });

  // Indikator "sedang bekerja" TIDAK lagi dirender di sini — sekarang dipegang elemen
  // permanen `.message-working` di luar contentElem (lihat createAssistantMessage), supaya
  // animasi maskotnya tidak restart setiap chunk masuk. Label statusnya diperbarui lewat
  // applyMascotState() dari handler 'chunk'.
  return html;
}

/** Nama file yang sedang ditulis model, kalau tag <sendago_edit> sudah mulai mengalir. */
function detectWritingFileName(raw) {
  const match = /<sendago_edit\s+file="([^"]+)"/i.exec(raw || '');
  return match ? match[1] : null;
}

function stripAnsi(str) {
  return str ? str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') : '';
}

// Terminal Execution Streaming Handlers
function renderTerminalBlockStart(termId, command, desc) {
  const block = document.createElement('div');
  block.className = 'claude-terminal-block';
  block.id = termId;
  block.innerHTML = `
    <div class="terminal-block-header" title="Klik untuk melipat / membuka output">
      <div class="terminal-cmd-title" title="${escapeHtml(command)}">
        <span class="cmd-icon-pulse">⚡</span>
        <code>$ ${escapeHtml(command)}</code>
      </div>
      <div class="terminal-header-right">
        <span class="terminal-status-badge running">${mascotHtml('mascot-xs', POSE_RUNNING_CMD)} Menjalankan...</span>
        <span class="terminal-chevron">▼</span>
      </div>
    </div>
    <pre class="terminal-stdout-view"></pre>
  `;
  const node = appendTimelineNode(block, 'running');
  autoScrollIfNearBottom();

  const header = block.querySelector('.terminal-block-header');
  header?.addEventListener('click', () => {
    block.classList.toggle('collapsed');
  });

  activeTerminalBlocks.set(termId, {
    elem: block,
    node,
    stdoutElem: block.querySelector('.terminal-stdout-view'),
    statusBadge: block.querySelector('.terminal-status-badge'),
    iconPulse: block.querySelector('.cmd-icon-pulse')
  });
}

function appendTerminalChunk(termId, text, isStderr) {
  const entry = activeTerminalBlocks.get(termId);
  if (!entry) return;
  const clean = stripAnsi(text);
  if (isStderr) {
    const span = document.createElement('span');
    span.className = 'stderr-line';
    span.textContent = clean;
    entry.stdoutElem.appendChild(span);
  } else {
    entry.stdoutElem.appendChild(document.createTextNode(clean));
  }
  entry.stdoutElem.scrollTop = entry.stdoutElem.scrollHeight;
}

function resolveTerminalBlockEnd(termId, exitCode, durationMs, timedOut) {
  const entry = activeTerminalBlocks.get(termId);
  if (!entry) return;
  const ok = exitCode === 0;
  entry.statusBadge.className = `terminal-status-badge ${ok ? 'success' : 'fail'}`;
  if (timedOut) {
    entry.statusBadge.textContent = `⏱ Waktu Habis (${durationMs}ms)`;
  } else {
    entry.statusBadge.textContent = ok ? `✔ Berhasil (${durationMs}ms)` : `❌ Exit ${exitCode} (${durationMs}ms)`;
  }
  if (entry.iconPulse) {
    entry.iconPulse.classList.remove('cmd-icon-pulse');
  }
  if (entry.node) {
    entry.node.className = `timeline-node ${ok ? 'success' : 'error'}`;
  }
}

// Finalisasi bubble assistant yang sedang aktif jadi HTML statis (bukan lagi mode
// streaming), dipanggil setiap kali sebuah "segmen" percakapan berakhir: mau karena loop
// lanjut ke step berikutnya, mau karena mau menyusun kesimpulan akhir, dsb.
function finalizeCurrentBubble() {
  if (!currentAssistantBubble) return;
  const html = renderCleanChat(currentAssistantBubble.rawText, true);

  // Giliran ini sudah selesai — maskot berhenti bekerja.
  currentAssistantBubble.workingElem?.remove();

  if (!html || !html.trim()) {
    // Giliran ini tidak menghasilkan teks sama sekali (umum untuk native tool-calling murni
    // — model cuma memanggil tool tanpa narasi). Buang bubble loading kosong ini dari DOM
    // sepenuhnya, dan JANGAN reset timeline — biar toast/terminal block giliran berikutnya
    // tetap menyambung ke timeline yang sama alih-alih terputus per giliran.
    currentAssistantBubble.elem.remove();
    currentAssistantBubble = null;
    return;
  }

  currentAssistantBubble.contentElem.innerHTML = html;
  attachCodeBlockActions(currentAssistantBubble.contentElem);
  // Bubble ini punya konten nyata — mulai segmen timeline baru setelah ini supaya
  // aktivitas berikutnya tidak "menyambung ke atas" teks yang sudah final.
  currentTimelineContainer = null;
}

function handleLoopStep(step, maxSteps, isLoop) {
  if (!isLoop) return;
  // Sengaja TIDAK lagi menampilkan badge "Step N/M" terpisah — dengan safety-net step
  // yang sekarang jauh lebih besar (task kompleks bisa jalan puluhan langkah), counter
  // seperti itu terasa mekanis ("kaku") dan berulang alih-alih mengalir natural. Bubble
  // baru di bawah ini sudah punya shimmer loader sendiri yang menandakan AI masih bekerja
  // — itu cukup, mengikuti alur yang lebih mirip timeline Claude Code (tanpa hitungan step).
  finalizeCurrentBubble();
  currentAssistantBubble = createAssistantMessage();
  autoScrollIfNearBottom();
}

function handleStartFinalSummary() {
  // Loop otonom berhenti (stagnasi terdeteksi atau safety-net step tercapai) dan backend
  // meminta satu giliran terakhir TANPA tool supaya AI merangkum hasilnya dalam bahasa
  // natural — finalize bubble lama & siapkan bubble baru untuk teks kesimpulan tsb.
  finalizeCurrentBubble();

  const badge = document.createElement('div');
  badge.className = 'claude-loop-badge';
  badge.innerHTML = `${mascotHtml('mascot-sm', POSE_SUMMARY)} <span><strong>Menyusun kesimpulan...</strong></span>`;
  appendTimelineNode(badge, 'running');

  currentAssistantBubble = createAssistantMessage();
  autoScrollIfNearBottom();
}

function handleTaskCompleted(summary) {
  const doneElem = document.createElement('div');
  doneElem.className = 'claude-done-badge';
  // Pose "Selesai!" (maskot dengan centang hijau) — statis, bukan indikator kerja,
  // jadi animasinya dimatikan lewat class mascot-static.
  doneElem.innerHTML = `${mascotHtml('mascot-sm mascot-static', POSE_DONE)} <span>${escapeHtml(summary || 'Tugas selesai dan diverifikasi otonom.')}</span>`;
  appendTimelineNode(doneElem, 'success');
  autoScrollIfNearBottom();
}

function appendAutoExecToast(icon, text) {
  const toast = document.createElement('div');
  toast.className = 'auto-exec-toast';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(text)}</span>`;
  appendTimelineNode(toast, 'success');
  autoScrollIfNearBottom();
}

function getShortPath(fullPath) {
  if (!fullPath) return '';
  const clean = fullPath.replace(/\\/g, '/');
  const projName = document.getElementById('project-name')?.innerText?.trim();
  if (projName && clean.includes(projName)) {
    const idx = clean.indexOf(projName);
    return clean.slice(idx);
  }
  const parts = clean.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : clean;
}

// Action Panels (Commands, Files, Images, Plans)
function requestRunCommand(command, btn, onResult) {
  const requestId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  pendingCommandRequests.set(requestId, { btn, onResult });
  btn.innerText = 'Menunggu...';
  btn.disabled = true;
  vscode.postMessage({ type: 'runCommand', command, requestId });
}

function resolvePendingCommandButton(requestId, ran) {
  const entry = pendingCommandRequests.get(requestId);
  if (!entry) return;
  pendingCommandRequests.delete(requestId);
  const { btn, onResult } = entry;
  btn.disabled = false;
  if (ran) {
    btn.innerText = 'Executed 🚀';
    btn.style.backgroundColor = '#10b981';
    btn.style.color = '#fff';
  } else {
    btn.innerText = 'Dibatalkan';
    setTimeout(() => { btn.innerText = '▶ Run'; }, 2000);
  }
  onResult?.(ran);
}

function renderCommandCards(commands, autoApplied) {
  if (autoApplied) {
    // Backend autonomous loop akan/telah mengeksekusi command ini sendiri (lihat
    // blok terminal terpisah) — jangan trigger eksekusi kedua dari sisi client.
    return;
  }

  if (autoMode) {
    commands.forEach(cmd => {
      appendAutoExecToast('⚡', `Auto-run: ${cmd.command}`);
      vscode.postMessage({ type: 'runCommand', command: cmd.command, requestId: `auto_${Date.now()}_${Math.random().toString(36).slice(2)}` });
    });
    return;
  }

  actionsPanel.style.display = 'flex';
  const container = document.createElement('div');
  container.className = 'compact-actions-list';

  const isPlanOnly = permissionMode === 'plan-only';
  const header = document.createElement('div');
  header.className = 'compact-panel-header';
  header.innerHTML = isPlanOnly
    ? `<span>⚡ Perintah Terminal</span><span class="manual-badge">🔒 Plan-Only</span>`
    : `<span>⚡ Perintah Terminal</span><span class="manual-badge">🛡️ Ask</span>`;
  container.appendChild(header);

  commands.forEach(cmd => {
    const row = document.createElement('div');
    row.className = 'compact-row';
    const actionsHtml = isPlanOnly
      ? `<button class="btn-micro" disabled title="Dikunci oleh Plan-Only Mode (.sendago/settings.json)">🔒 Locked</button>`
      : `<button class="btn-micro btn-skip-micro" title="Lewati">✕</button><button class="btn-micro btn-run-micro">▶ Run</button>`;
    row.innerHTML = `
      <div class="row-left" title="${escapeHtml(cmd.command)}">
        <span class="row-icon">⚡</span>
        <code class="row-code">${escapeHtml(cmd.command)}</code>
      </div>
      <div class="row-actions">${actionsHtml}</div>
    `;

    if (!isPlanOnly) {
      row.querySelector('.btn-skip-micro').addEventListener('click', () => {
        row.remove();
      });

      row.querySelector('.btn-run-micro').addEventListener('click', (e) => {
        requestRunCommand(cmd.command, e.target, (ran) => {
          if (!ran) return;
          setTimeout(() => {
            row.remove();
            if (container.querySelectorAll('.compact-row').length === 0) {
              actionsPanel.style.display = 'none';
            }
          }, 600);
        });
      });
    }

    container.appendChild(row);
  });

  actionsPanel.appendChild(container);
}

function renderFileEditCards(edits) {
  if (autoMode) {
    // In autoMode, sidebarProvider automatically writes the files to disk
    // and sends 'filesAutoApplied' to avoid duplicate write race conditions.
    return;
  }

  actionsPanel.style.display = 'flex';
  const container = document.createElement('div');
  container.className = 'compact-actions-list';

  const isPlanOnly = permissionMode === 'plan-only';
  const header = document.createElement('div');
  header.className = 'compact-panel-header';
  header.innerHTML = isPlanOnly
    ? `<span>📄 File Diedit</span><span class="manual-badge">🔒 Plan-Only</span>`
    : `<span>📄 File Diedit</span><span class="manual-badge">🛡️ Ask</span>`;
  container.appendChild(header);

  const rowsByPath = new Map();

  edits.forEach(edit => {
    const shortPath = getShortPath(edit.filePath);
    const row = document.createElement('div');
    row.className = 'compact-row';
    // Diff preview tetap read-only jadi tetap boleh dilihat di Plan-Only Mode — cuma Apply yang dikunci.
    const applyBtnHtml = isPlanOnly
      ? `<button class="btn-micro" disabled title="Dikunci oleh Plan-Only Mode (.sendago/settings.json)">🔒 Locked</button>`
      : `<button class="btn-micro btn-apply-micro" title="Tulis file">Apply</button>`;
    row.innerHTML = `
      <div class="row-left" title="${escapeHtml(edit.filePath)}">
        <span class="row-icon">📄</span>
        <span class="row-filename">${escapeHtml(shortPath)}</span>
      </div>
      <div class="row-actions">
        <button class="btn-micro btn-diff-micro" title="Preview Diff">Diff</button>
        ${applyBtnHtml}
      </div>
    `;

    row.querySelector('.btn-diff-micro').addEventListener('click', () => {
      vscode.postMessage({ type: 'viewDiff', filePath: edit.filePath, content: edit.newContent });
    });

    const applyBtn = row.querySelector('.btn-apply-micro');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const requestId = `edit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        pendingEditRequests.set(requestId, { btn: applyBtn, row, container });
        applyBtn.innerText = 'Applying...';
        applyBtn.disabled = true;
        vscode.postMessage({ type: 'applyEdit', filePath: edit.filePath, content: edit.newContent, requestId });
      });
      rowsByPath.set(edit.filePath, { btn: applyBtn, row });
    }

    container.appendChild(row);
  });

  if (!isPlanOnly && edits.length > 1) {
    const bar = document.createElement('div');
    bar.className = 'compact-batch-bar';
    bar.innerHTML = `
      <span><strong>${edits.length} file diusulkan</strong></span>
      <button id="btn-apply-all" class="btn-micro-primary">Apply All (${edits.length})</button>
    `;
    const applyAllBtn = bar.querySelector('#btn-apply-all');
    applyAllBtn.addEventListener('click', () => {
      const requestId = `editall_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingApplyAllRequests.set(requestId, { btn: applyAllBtn, container, rowsByPath });
      applyAllBtn.innerText = 'Applying...';
      applyAllBtn.disabled = true;
      vscode.postMessage({
        type: 'applyAllEdits',
        edits: edits.map(ed => ({ filePath: ed.filePath, content: ed.newContent })),
        requestId
      });
    });
    container.insertBefore(bar, container.firstChild);
  }

  actionsPanel.appendChild(container);
}

function resolveEditApplied(message) {
  const entry = pendingEditRequests.get(message.requestId);
  if (!entry) return;
  pendingEditRequests.delete(message.requestId);
  const { btn, row, container } = entry;
  if (message.success) {
    btn.innerText = 'Applied ✔';
    btn.style.backgroundColor = '#059669';
    setTimeout(() => {
      row.remove();
      if (container.querySelectorAll('.compact-row').length === 0) {
        actionsPanel.style.display = 'none';
      }
    }, 500);
  } else {
    btn.innerText = '❌ Gagal';
    btn.disabled = false;
  }
}

function resolveAllEditsApplied(message) {
  const entry = pendingApplyAllRequests.get(message.requestId);
  if (!entry) return;
  pendingApplyAllRequests.delete(message.requestId);
  const { btn, container, rowsByPath } = entry;
  btn.innerText = `Applied ✔ (${message.count})`;
  btn.style.backgroundColor = '#059669';
  setTimeout(() => {
    container.remove();
    if (actionsPanel.querySelectorAll('.compact-actions-list').length === 0) {
      actionsPanel.style.display = 'none';
    }
  }, 600);
}

function renderFileReplaceCards(replaces) {
  if (autoMode) {
    return;
  }

  actionsPanel.style.display = 'flex';
  const container = document.createElement('div');
  container.className = 'compact-actions-list';

  const isPlanOnly = permissionMode === 'plan-only';
  const header = document.createElement('div');
  header.className = 'compact-panel-header';
  header.innerHTML = isPlanOnly
    ? `<span>✨ Perbaikan Code</span><span class="manual-badge">🔒 Plan-Only</span>`
    : `<span>✨ Perbaikan Code</span><span class="manual-badge">🛡️ Ask</span>`;
  container.appendChild(header);

  replaces.forEach(rep => {
    const shortPath = getShortPath(rep.filePath);
    const row = document.createElement('div');
    row.className = 'compact-row';
    const actionsHtml = isPlanOnly
      ? `<button class="btn-micro" disabled title="Dikunci oleh Plan-Only Mode (.sendago/settings.json)">🔒 Locked</button>`
      : `<button class="btn-micro btn-skip-micro" title="Lewati">✕</button><button class="btn-micro btn-apply-micro" title="Terapkan perubahan">Apply</button>`;
    row.innerHTML = `
      <div class="row-left" title="${escapeHtml(rep.filePath)}">
        <span class="row-icon">✨</span>
        <span class="row-filename">${escapeHtml(shortPath)}</span>
      </div>
      <div class="row-actions">${actionsHtml}</div>
    `;

    if (!isPlanOnly) {
      row.querySelector('.btn-skip-micro').addEventListener('click', () => {
        row.remove();
        if (container.querySelectorAll('.compact-row').length === 0) {
          actionsPanel.style.display = 'none';
        }
      });

      const applyBtn = row.querySelector('.btn-apply-micro');
      applyBtn.addEventListener('click', () => {
        const requestId = `rep_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        pendingReplaceRequests.set(requestId, { btn: applyBtn, row, container });
        applyBtn.innerText = 'Applying...';
        applyBtn.disabled = true;
        vscode.postMessage({
          type: 'applyReplace',
          filePath: rep.filePath,
          searchContent: rep.searchContent,
          replaceContent: rep.replaceContent,
          requestId
        });
      });
    }

    container.appendChild(row);
  });

  actionsPanel.appendChild(container);
}

function resolveReplaceApplied(message) {
  const entry = pendingReplaceRequests.get(message.requestId);
  if (!entry) return;
  pendingReplaceRequests.delete(message.requestId);
  const { btn, row, container } = entry;
  if (message.success) {
    btn.innerText = `Applied ✔ (L${message.line || 1})`;
    btn.style.backgroundColor = '#059669';
    setTimeout(() => {
      row.remove();
      if (container.querySelectorAll('.compact-row').length === 0) {
        actionsPanel.style.display = 'none';
      }
    }, 500);
  } else {
    btn.innerText = '❌ Gagal';
    btn.title = message.error || 'Gagal replace';
    btn.disabled = false;
  }
}

function renderImageCards(images) {
  if (autoMode) {
    images.forEach(img => {
      appendAutoExecToast('🖼️', `Auto-generate: ${img.filePath}`);
      vscode.postMessage({
        type: 'generateImage',
        filePath: img.filePath,
        prompt: img.prompt,
        width: img.width || 1024,
        height: img.height || 1024,
        requestId: `autoimg_${Date.now()}`
      });
    });
    return;
  }

  actionsPanel.style.display = 'flex';
  const container = document.createElement('div');
  container.className = 'compact-actions-list';

  const isPlanOnly = permissionMode === 'plan-only';
  const header = document.createElement('div');
  header.className = 'compact-panel-header';
  header.innerHTML = isPlanOnly
    ? `<span>🖼️ Generate Gambar</span><span class="manual-badge">🔒 Plan-Only</span>`
    : `<span>🖼️ Generate Gambar</span><span class="manual-badge">🛡️ Ask</span>`;
  container.appendChild(header);

  images.forEach(img => {
    const shortPath = getShortPath(img.filePath);
    const row = document.createElement('div');
    row.className = 'compact-row';
    const actionHtml = isPlanOnly
      ? `<button class="btn-micro" disabled title="Dikunci oleh Plan-Only Mode (.sendago/settings.json)">🔒 Locked</button>`
      : `<button class="btn-micro btn-gen-micro" title="${escapeHtml(img.prompt)}">🪄 Generate</button>`;
    row.innerHTML = `
      <div class="row-left" title="Prompt: ${escapeHtml(img.prompt)}">
        <span class="row-icon">🖼️</span>
        <span class="row-filename">${escapeHtml(shortPath)}</span>
      </div>
      <div class="row-actions">${actionHtml}</div>
    `;

    const genBtn = row.querySelector('.btn-gen-micro');
    if (genBtn) {
      genBtn.addEventListener('click', (e) => {
        const requestId = `img_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        pendingImageRequests.set(requestId, { btn: e.target, row, container });
        e.target.innerText = 'Creating 🎨...';
        e.target.disabled = true;
        vscode.postMessage({
          type: 'generateImage',
          filePath: img.filePath,
          prompt: img.prompt,
          width: img.width || 1024,
          height: img.height || 1024,
          requestId
        });
      });
    }

    container.appendChild(row);
  });

  actionsPanel.appendChild(container);
}

function resolveImageGenerationResult(message) {
  const entry = pendingImageRequests.get(message.requestId);
  if (!entry) return;
  pendingImageRequests.delete(message.requestId);
  const { btn, row, container } = entry;
  if (message.success) {
    btn.innerText = 'Created ✔';
    btn.style.backgroundColor = '#059669';
    setTimeout(() => {
      row.remove();
      if (container.querySelectorAll('.compact-row').length === 0) {
        actionsPanel.style.display = 'none';
      }
    }, 600);
  } else {
    btn.innerText = '❌ Gagal';
    btn.disabled = false;
  }
}

function renderPlanCard(steps) {
  actionsPanel.style.display = 'flex';
  const card = document.createElement('div');
  card.className = 'plan-card';

  let stepsHtml = '';
  steps.forEach(step => {
    const cmdBtn = step.command
      ? `<button class="btn-cmd" data-cmd="${escapeHtml(step.command)}">▶ Run</button>`
      : '';
    stepsHtml += `
      <div class="plan-step-item">
        <input type="checkbox" id="step-${step.id}">
        <label for="step-${step.id}" style="flex: 1;">
          <strong>Step ${step.id}: ${escapeHtml(step.title)}</strong>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(step.description || '')}</div>
        </label>
        ${cmdBtn}
      </div>
    `;
  });

  card.innerHTML = `
    <div class="plan-header">
      <span>📋</span>
      <span>Execution Plan (${steps.length} Steps)</span>
    </div>
    <div class="plan-steps-list">${stepsHtml}</div>
  `;

  card.querySelectorAll('.btn-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      requestRunCommand(btn.dataset.cmd, btn);
    });
  });

  actionsPanel.appendChild(card);
}

