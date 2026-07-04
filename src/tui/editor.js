'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const driver = require('../driver');
const screen = require('./screen');

let isWaitingResponse = false;
let inputBuffer = '';
let cursorOffset = 0;
let lastPromptLinesCount = 1;

function setIsWaitingResponse(val) {
  isWaitingResponse = val;
}

let autocompleteVisible = false;
let autocompleteOptions = [];
let autocompleteSelectedIdx = 0;
let autocompleteQuery = '';

let historySelectionVisible = false;
let historyOptions = [];
let historySelectedIdx = 0;

function showHistorySelection(historyItems, hasMore) {
  historyOptions = historyItems.map(item => ({
    display: item.title || 'Không có tiêu đề',
    value: item.id
  }));
  
  if (hasMore) {
    historyOptions.push({
      display: ' ❯ ⟳ Tải thêm cuộc hội thoại cũ hơn...',
      value: 'load_more'
    });
  }
  
  historySelectionVisible = true;
  historySelectedIdx = 0;
  setIsWaitingResponse(true);
  renderUI();
}
let autocompleteIndex = -1;

// Trạng thái menu chọn mô hình (Model Selection)
let modelSelectionVisible = false;
let modelSelectedIdx = 0;

// Trạng thái menu chọn chế độ suy nghĩ (Thinking Mode Selection)
let thinkingSelectionVisible = false;
let thinkingSelectedIdx = 0;
const thinkingOptions = [
  { display: 'Auto (Tự động)', value: 'auto' },
  { display: 'Thinking (Suy nghĩ sâu)', value: 'thinking' },
  { display: 'Fast (Trả lời nhanh)', value: 'fast' }
];

const modelOptions = [
  // Thế hệ 3.7
  { display: 'Qwen3.7-Plus', value: 'qwen3.7-plus' },
  { display: 'Qwen3.7-Max', value: 'qwen3.7-max' },
  // { display: 'Qwen3.7-Max-Preview', value: 'qwen-latest-series-invite-beta-v24' },
  // { display: 'Qwen3.7-Plus-Preview', value: 'qwen-latest-series-invite-beta-v16' },

  // Thế hệ 3.6
  { display: 'Qwen3.6-Plus', value: 'qwen3.6-plus' },
  { display: 'Qwen3.6-Max-Preview', value: 'qwen3.6-max-preview' },
  // { display: 'Qwen3.6-35B-A3B', value: 'qwen3.6-35b-a3b' },
  // { display: 'Qwen3.6-27B', value: 'qwen3.6-27b' },
  // { display: 'Qwen3.6-Plus-Preview', value: 'qwen3.6-plus-preview' },

  // Thế hệ 3.5
  { display: 'Qwen3.5-Plus', value: 'qwen3.5-plus' },
  { display: 'Qwen3.5-Max-Preview', value: 'qwen3.5-max-2026-03-08' },
  { display: 'Qwen3.5-Omni-Plus', value: 'qwen3.5-omni-plus' },
  { display: 'Qwen3.5-Flash', value: 'qwen3.5-flash' },
  // { display: 'Qwen3.5-397B-A17B', value: 'qwen3.5-397b-a17b' },
  // { display: 'Qwen3.5-122B-A10B', value: 'qwen3.5-122b-a10b' },
  { display: 'Qwen3.5-Omni-Flash', value: 'qwen3.5-omni-flash' },
  // { display: 'Qwen3.5-27B', value: 'qwen3.5-27b' },
  // { display: 'Qwen3.5-35B-A3B', value: 'qwen3.5-35b-a3b' },

  // Thế hệ Qwen3
  { display: 'Qwen3-Max', value: 'qwen3-max-2026-01-23' },
  // { display: 'Qwen3-235B-A22B', value: 'qwen-plus-2025-07-28' },
  { display: 'Qwen3-Coder', value: 'qwen3-coder-plus' },
  { display: 'Qwen3-VL-235B-A22B', value: 'qwen3-vl-plus' },
  { display: 'Qwen3-Omni-Flash', value: 'qwen3-omni-flash-2025-12-01' }
];

const slashCommands = [
  { display: '/model (Thay đổi mô hình chat)', value: '/model' },
  { display: '/m (Thay đổi mô hình chat)', value: '/m' },
  { display: '/mode (Thay đổi chế độ suy nghĩ)', value: '/mode' },
  { display: '/md (Thay đổi chế độ suy nghĩ)', value: '/md' },
  { display: '/detail (Bật/tắt hiển thị suy nghĩ chi tiết)', value: '/detail' },
  { display: '/dt (Bật/tắt hiển thị suy nghĩ chi tiết)', value: '/dt' },
  { display: '/websearch (Bật/tắt Tìm kiếm Web)', value: '/websearch' },
  { display: '/ws (Bật/tắt Tìm kiếm Web)', value: '/ws' },
  { display: '/resume (Tiếp tục chat từ lịch sử)', value: '/resume' },
  { display: '/rs (Tiếp tục chat từ lịch sử)', value: '/rs' },
  { display: '/new (Tạo cuộc trò chuyện mới)', value: '/new' },
  { display: '/exit (Thoát ứng dụng)', value: '/exit' }
];

let lastMenuLength = 0;

function drawTopBorder(boxWidth, title) {
  const borderLength = boxWidth - 4;
  if (title && borderLength >= title.length + 4) {
    const leftBorder = '─'.repeat(2);
    const rightBorder = '─'.repeat(borderLength - 2 - title.length);
    return '  ┌' + leftBorder + '\x1b[1m\x1b[38;5;147m' + title + '\x1b[0m' + rightBorder + '┐';
  } else {
    return '  ┌' + '─'.repeat(borderLength) + '┐';
  }
}

function renderBoxedMenu(rows, promptLinesCount, items, selectedIdx, title, getDisplay) {
  const terminalRows = process.stdout.rows || 24;
  const terminalCols = process.stdout.columns || 80;
  const boxWidth = Math.max(40, terminalCols - 8);
  const textWidth = boxWidth - 8;
  const menuLength = items.length;

  // 1. Draw Top Border
  const topBorderRow = terminalRows - 1 - (promptLinesCount - 1) - (menuLength + 2);
  process.stdout.write(`\x1b[${topBorderRow};1H\x1b[K`);
  process.stdout.write(drawTopBorder(boxWidth, title));

  // 2. Draw Items
  items.forEach((item, idx) => {
    const lineRow = terminalRows - 1 - (promptLinesCount - 1) - (menuLength + 2) + 1 + idx;
    process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
    
    const isSelected = idx === selectedIdx;
    const displayText = getDisplay(item);
    const displayTitle = displayText.length > textWidth
      ? displayText.substring(0, textWidth - 3) + '...'
      : displayText;
    const paddedText = displayTitle.padEnd(textWidth, ' ');
    
    if (isSelected) {
      process.stdout.write(`  │\x1b[48;5;75m\x1b[30m ❯ ${paddedText} \x1b[0m│`);
    } else {
      process.stdout.write(`  │\x1b[48;5;236m\x1b[37m   ${paddedText} \x1b[0m│`);
    }
  });

  // 3. Draw Bottom Border
  const bottomBorderRow = terminalRows - 1 - (promptLinesCount - 1) - 1;
  process.stdout.write(`\x1b[${bottomBorderRow};1H\x1b[K`);
  process.stdout.write('  └' + '─'.repeat(boxWidth - 4) + '┘');
}

function renderStatusBarOnly() {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  
  process.stdout.write(`\x1b[${rows};1H\x1b[K`);
  const searchStatus = driver.getWebSearch() 
    ? '\x1b[1m\x1b[32mBẬT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m' 
    : '\x1b[2mTẮT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m';
  
  const currentModelVal = driver.getModelName();
  const matchedModel = modelOptions.find(m => m.value === currentModelVal);
  const modelDisplayName = matchedModel ? matchedModel.display.split(' ')[0] : currentModelVal;
  const modelDisplay = `\x1b[1m\x1b[38;5;220m${modelDisplayName}\x1b[0m\x1b[48;5;235m\x1b[38;5;250m`;
  
  const currentModeVal = driver.getThinkingMode();
  let thinkingModeColor = '38;5;80m'; // Auto
  if (currentModeVal === 'thinking') thinkingModeColor = '38;5;141m';
  else if (currentModeVal === 'fast') thinkingModeColor = '38;5;208m';
  const thinkingDisplayName = currentModeVal === 'fast' ? 'Fast' : (currentModeVal === 'thinking' ? 'Thinking' : 'Auto');
  const thinkingDisplay = `\x1b[1m\x1b[${thinkingModeColor}${thinkingDisplayName}\x1b[0m\x1b[48;5;235m\x1b[38;5;250m`;
  
  const detailedStatus = driver.isDetailedThinking() 
    ? '\x1b[1m\x1b[32mBẬT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m' 
    : '\x1b[2mTẮT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m';
  
  const barText = ` 💻 Qwen CLI │ 🌐 Tìm kiếm: ${searchStatus} │ 🧠 Suy nghĩ: ${thinkingDisplay} │ ⚙️ Chi tiết: ${detailedStatus} │ 🤖 Model: ${modelDisplay} `;
  
  // Calculate padding based on visible text length
  const ansiRegex = /\u001b\[[0-9;]*m/g;
  const visibleLen = barText.replace(ansiRegex, '').length;
  const paddingLen = Math.max(0, cols - visibleLen);
  
  process.stdout.write(`\x1b[48;5;235m\x1b[38;5;250m${barText}${' '.repeat(paddingLen)}\x1b[0m`);

  // Phục hồi con trỏ gõ
  const segments = getWrappedSegments(inputBuffer, cols);
  let cursorLineIdx = 0;
  let cursorCol = 0;
  const firstLineLimit = cols - 7;
  if (cursorOffset <= firstLineLimit) {
    cursorLineIdx = 0;
    cursorCol = 7 + cursorOffset;
  } else {
    let remainingOffset = cursorOffset - firstLineLimit;
    cursorLineIdx = 1 + Math.floor(remainingOffset / cols);
    cursorCol = remainingOffset % cols;
  }
  if (cursorCol >= cols) {
    cursorCol = 0;
    cursorLineIdx += 1;
  }
  const promptLinesCount = Math.max(segments.length, cursorLineIdx + 1);
  const startRow = rows - 1 - (promptLinesCount - 1);
  const cursorRow = startRow + cursorLineIdx;
  process.stdout.write(`\x1b[${cursorRow};${cursorCol + 1}H`);
}

function getWrappedSegments(input, cols) {
  const prefixLen = 7;
  const segments = [];
  
  const firstLineLimit = cols - prefixLen;
  if (input.length <= firstLineLimit) {
    segments.push(input);
    return segments;
  }
  
  segments.push(input.substring(0, firstLineLimit));
  let remaining = input.substring(firstLineLimit);
  
  while (remaining.length > 0) {
    segments.push(remaining.substring(0, cols));
    remaining = remaining.substring(cols);
  }
  
  return segments;
}

// Hàm vẽ giao diện Terminal Custom Prompt, Dropdown Autocomplete & Model Selector
function renderUI() {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;

  // Tính toán số dòng của prompt hiện tại và vị trí con trỏ
  const segments = getWrappedSegments(inputBuffer, cols);
  
  let cursorLineIdx = 0;
  let cursorCol = 0;
  
  const firstLineLimit = cols - 7;
  if (cursorOffset <= firstLineLimit) {
    cursorLineIdx = 0;
    cursorCol = 7 + cursorOffset;
  } else {
    let remainingOffset = cursorOffset - firstLineLimit;
    cursorLineIdx = 1 + Math.floor(remainingOffset / cols);
    cursorCol = remainingOffset % cols;
  }
  
  if (cursorCol >= cols) {
    cursorCol = 0;
    cursorLineIdx += 1;
  }
  
  const promptLinesCount = Math.max(segments.length, cursorLineIdx + 1);
  screen.setPromptLinesCount(promptLinesCount);

  // 1. Dọn dẹp các dòng menu cũ dựa trên vị trí cũ
  const currentMenuLength = modelSelectionVisible 
    ? (modelOptions.length + 2)
    : (thinkingSelectionVisible
      ? (thinkingOptions.length + 2)
      : (autocompleteVisible && autocompleteOptions.length > 0 
         ? (autocompleteOptions.length + 2)
         : (historySelectionVisible 
            ? (Math.min(10, historyOptions.length) + 2) 
            : 0)));
  
  const prevMenuStart = rows - 1 - (lastPromptLinesCount - 1) - lastMenuLength;
  const currentMenuStart = rows - 1 - (promptLinesCount - 1) - currentMenuLength;
  
  const clearStartRow = Math.min(prevMenuStart, currentMenuStart);
  const clearEndRow = rows - 1 - (promptLinesCount - 1) - 1;
  
  for (let r = clearStartRow; r <= clearEndRow; r++) {
    process.stdout.write(`\x1b[${r};1H\x1b[K`);
  }
  
  lastMenuLength = currentMenuLength;
  lastPromptLinesCount = promptLinesCount;

  // 2. Vẽ các dòng của prompt (ghim ở dưới cùng trước status bar)
  const startRow = rows - 1 - (promptLinesCount - 1);
  for (let i = 0; i < promptLinesCount; i++) {
    const lineRow = startRow + i;
    process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
    if (i === 0) {
      process.stdout.write(`\x1b[1m\x1b[38;5;75m👤 You:\x1b[0m ${segments[0] || ''}`);
    } else {
      process.stdout.write(segments[i] || '');
    }
  }

  // 3. Vẽ thanh trạng thái (Status Bar) ghim ở dòng cuối cùng (rows)
  renderStatusBarOnly();

  // 4. Vẽ menu chọn mô hình (Model Selector) nổi bật bằng khung viền
  if (modelSelectionVisible) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      modelOptions,
      modelSelectedIdx,
      ' Chọn Mô Hình ',
      (opt) => opt.display
    );
  }
  // Vẽ menu chọn chế độ suy nghĩ (Thinking Selector)
  else if (thinkingSelectionVisible) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      thinkingOptions,
      thinkingSelectedIdx,
      ' Chế Độ Suy Nghĩ ',
      (opt) => opt.display
    );
  }
  // 5. Vẽ menu gợi ý dropdown tệp tin
  else if (autocompleteVisible && autocompleteOptions.length > 0) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      autocompleteOptions,
      autocompleteSelectedIdx,
      ' Gợi Ý Tệp Tin ',
      (opt) => opt.display
    );
  }
  // Vẽ menu chọn lịch sử (History Selector)
  else if (historySelectionVisible) {
    const maxVisibleOptions = 10;
    let startIdx = 0;
    if (historyOptions.length > maxVisibleOptions) {
      startIdx = Math.max(0, historySelectedIdx - Math.floor(maxVisibleOptions / 2));
      if (startIdx + maxVisibleOptions > historyOptions.length) {
        startIdx = historyOptions.length - maxVisibleOptions;
      }
    }
    const visibleOptions = historyOptions.slice(startIdx, startIdx + maxVisibleOptions);
    
    renderBoxedMenu(
      rows,
      promptLinesCount,
      visibleOptions,
      historySelectedIdx - startIdx,
      ' Lịch Sử Cuộc Trò Chuyện ',
      (opt) => opt.display
    );
  }

  // 6. Đặt vị trí con trỏ nhấp nháy đúng dòng và cột của nó
  const cursorRow = startRow + cursorLineIdx;
  process.stdout.write(`\x1b[${cursorRow};${cursorCol + 1}H`);
}

// Quét thư mục hoặc danh sách lệnh tìm gợi ý tương ứng
function checkAutocomplete() {
  const textBeforeCursor = inputBuffer.slice(0, cursorOffset);
  const words = textBeforeCursor.split(/\s+/);
  const lastWord = words[words.length - 1];

  if (lastWord && lastWord.startsWith('@')) {
    autocompleteQuery = lastWord.slice(1);
    autocompleteIndex = textBeforeCursor.lastIndexOf(lastWord);
    
    let searchDir = '.';
    let searchPrefix = autocompleteQuery;

    const lastSlashIdx = autocompleteQuery.lastIndexOf('/');
    if (lastSlashIdx >= 0) {
      searchDir = autocompleteQuery.slice(0, lastSlashIdx) || '/';
      searchPrefix = autocompleteQuery.slice(lastSlashIdx + 1);
    }

    try {
      const resolvedDir = path.resolve(process.cwd(), searchDir);
      if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
        const files = fs.readdirSync(resolvedDir);
        
        autocompleteOptions = files
          .filter(file => {
            if (['node_modules', '.git', 'debug', 'references'].includes(file)) return false;
            return file.toLowerCase().startsWith(searchPrefix.toLowerCase());
          })
          .map(file => {
            const fullPath = path.join(resolvedDir, file);
            const isDir = fs.statSync(fullPath).isDirectory();
            const relPath = searchDir === '.' ? file : `${searchDir}/${file}`;
            return {
              display: `${relPath}${isDir ? '/' : ''}`,
              value: `${relPath}${isDir ? '/' : ''}`,
              isDirectory: isDir
            };
          });

        if (autocompleteOptions.length > 0) {
          autocompleteVisible = true;
          if (autocompleteSelectedIdx >= autocompleteOptions.length) {
            autocompleteSelectedIdx = 0;
          }
          return;
        }
      }
    } catch (e) {}
  } else if (lastWord && lastWord.startsWith('/')) {
    autocompleteQuery = lastWord;
    autocompleteIndex = textBeforeCursor.lastIndexOf(lastWord);

    autocompleteOptions = slashCommands
      .filter(cmd => cmd.value.toLowerCase().startsWith(lastWord.toLowerCase()))
      .map(cmd => ({
        display: cmd.display,
        value: cmd.value,
        isCommand: true
      }));

    if (autocompleteOptions.length > 0) {
      autocompleteVisible = true;
      if (autocompleteSelectedIdx >= autocompleteOptions.length) {
        autocompleteSelectedIdx = 0;
      }
      return;
    }
  }

  autocompleteVisible = false;
  autocompleteOptions = [];
  autocompleteSelectedIdx = 0;
}

// Chọn một tệp tin/thư mục hoặc câu lệnh từ dropdown menu
function selectAutocompleteOption() {
  const selectedOpt = autocompleteOptions[autocompleteSelectedIdx];
  if (!selectedOpt) return;

  const textBeforeIdx = inputBuffer.slice(0, autocompleteIndex);
  const textAfterCursor = inputBuffer.slice(cursorOffset);
  
  let insertText = '';
  if (selectedOpt.isCommand) {
    insertText = selectedOpt.value;
  } else {
    insertText = `@${selectedOpt.value}`;
  }
  
  inputBuffer = textBeforeIdx + insertText + ' ' + textAfterCursor;
  cursorOffset = textBeforeIdx.length + insertText.length + 1;
  
  autocompleteVisible = false;
  autocompleteOptions = [];
  autocompleteSelectedIdx = 0;
}

// Tự động phát hiện và chuyển đổi các đường dẫn tệp tin kéo thả/paste vào terminal sang tiền tố @
function autoDetectDraggedPaths() {
  const linuxPathRegex = /(?:^|\s)(['"]?)(\/(?:[^\s'"\\]|\\ )+)\1(?=$|\s)/g;
  const windowsPathRegex = /(?:^|\s)(['"]?)([a-zA-Z]:\\(?:[^\s'"\\]|\\ )+)\1(?=$|\s)/g;
  
  let changed = false;

  const replaceFn = (match, quote, filePath) => {
    let cleanPath = filePath.replace(/\\ /g, ' ').trim();
    
    const trimmedMatch = match.trim();
    if (trimmedMatch.startsWith('@') || trimmedMatch.startsWith('"@') || trimmedMatch.startsWith("'@")) {
      return match;
    }

    try {
      if (fs.existsSync(cleanPath)) {
        changed = true;
        const leadingSpace = match.startsWith(' ') ? ' ' : '';
        // Luôn luôn tự động thêm khoảng trắng ở cuối tệp đính kèm được kéo thả 
        // để kết thúc từ, giúp AI nhận biết ngay và không kích hoạt autocomplete dropdown
        return `${leadingSpace}@${cleanPath} `;
      }
    } catch (e) {}

    return match;
  };

  const regex = process.platform === 'win32' ? windowsPathRegex : linuxPathRegex;
  const newBuffer = inputBuffer.replace(regex, replaceFn);

  if (changed) {
    const diff = newBuffer.length - inputBuffer.length;
    inputBuffer = newBuffer;
    cursorOffset += diff;
    
    // Tắt và reset trạng thái autocomplete dropdown ngay lập tức khi kéo thả
    autocompleteVisible = false;
    autocompleteOptions = [];
    autocompleteSelectedIdx = 0;
    
    renderUI();
  }
}

// Định dạng câu hỏi của người dùng thành một khối có màu nền giống menu /model
function formatUserPromptBlock(text, cols) {
  const contentWidth = Math.max(30, cols - 6); 
  const prefix = ' 👤 You: ';
  const lines = text.split('\n');
  const resultLines = [];
  
  let isFirstLine = true;
  for (let line of lines) {
    let startIdx = 0;
    while (startIdx < line.length || (startIdx === 0 && line.length === 0)) {
      const chunkLimit = contentWidth - prefix.length;
      const chunk = line.slice(startIdx, startIdx + chunkLimit);
      startIdx += chunkLimit;
      
      const lineText = isFirstLine ? (prefix + chunk) : (' '.repeat(prefix.length) + chunk);
      const paddedLine = lineText.padEnd(contentWidth, ' ');
      resultLines.push(`  \x1b[48;5;235m\x1b[38;5;253m${paddedLine}\x1b[0m`);
      
      isFirstLine = false;
      if (line.length === 0) break;
    }
  }
  
  return resultLines.join('\n') + '\n';
}

let currentOnResumeChat = null;

// Đăng ký sự kiện lắng nghe bàn phím
function setupTerminalInput(onSendMessage, onResumeChat) {
  currentOnResumeChat = onResumeChat;
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', async (str, key) => {
    // 1. Phím tắt ctrl+c để thoát
    if (key && key.ctrl && key.name === 'c') {
      screen.consoleLog('\nĐang thoát chương trình...');
      await screen.shutdownTUI();
    }

    // Phím tắt ctrl+d hoặc ctrl+t để bật/tắt hiển thị suy nghĩ chi tiết
    if (key && key.ctrl && (key.name === 'd' || key.name === 't')) {
      const newState = driver.toggleDetailedThinking();
      screen.consoleLog(`[Hệ thống] Hiển thị suy nghĩ chi tiết đã được: ${newState ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
      renderUI();
      return;
    }

    // 2. Phím cuộn trang PageUp/PageDown và Mũi tên Lên/Xuống
    if (key && key.name === 'pageup' && !modelSelectionVisible && !thinkingSelectionVisible && !historySelectionVisible) {
      screen.setScrollOffset(screen.getScrollOffset() + 12);
      screen.refreshScrollRegion();
      renderUI();
      return;
    }
    if (key && key.name === 'pagedown' && !modelSelectionVisible && !thinkingSelectionVisible && !historySelectionVisible) {
      screen.setScrollOffset(Math.max(0, screen.getScrollOffset() - 12));
      screen.refreshScrollRegion();
      renderUI();
      return;
    }
    if (key && key.name === 'up' && !autocompleteVisible && !modelSelectionVisible && !thinkingSelectionVisible && !historySelectionVisible && inputBuffer === '') {
      screen.setScrollOffset(screen.getScrollOffset() + 3);
      screen.refreshScrollRegion();
      renderUI();
      return;
    }
    if (key && key.name === 'down' && !autocompleteVisible && !modelSelectionVisible && !thinkingSelectionVisible && !historySelectionVisible && inputBuffer === '') {
      screen.setScrollOffset(Math.max(0, screen.getScrollOffset() - 3));
      screen.refreshScrollRegion();
      renderUI();
      return;
    }

    // 3. Logic xử lý phím bấm khi menu chọn mô hình (Model Selection) đang mở
    if (modelSelectionVisible) {
      if (key && (key.name === 'down' || (key.name === 'tab' && !key.shift))) {
        modelSelectedIdx = (modelSelectedIdx + 1) % modelOptions.length;
        renderUI();
        return;
      }
      if (key && (key.name === 'up' || (key.name === 'tab' && key.shift))) {
        modelSelectedIdx = (modelSelectedIdx - 1 + modelOptions.length) % modelOptions.length;
        renderUI();
        return;
      }
      if (key && key.name === 'escape') {
        modelSelectionVisible = false;
        setIsWaitingResponse(false);
        
        // Vẽ lại vùng cuộn lịch sử chat khi tắt menu
        screen.refreshScrollRegion();
        renderUI();
        return;
      }
      if (key && (key.name === 'enter' || key.name === 'return')) {
        const selectedModel = modelOptions[modelSelectedIdx];
        await driver.setModelName(selectedModel.value);
        
        screen.consoleLog(`[Hệ thống] Đã chuyển sang mô hình: \x1b[1m${selectedModel.display}\x1b[0m`);
        
        modelSelectionVisible = false;
        setIsWaitingResponse(false);
        renderUI();
        return;
      }
      return; // Khóa toàn bộ các phím bấm khác khi đang trong menu chọn model
    }

    // Logic xử lý phím bấm khi menu chọn chế độ suy nghĩ (Thinking Selection) đang mở
    if (thinkingSelectionVisible) {
      if (key && (key.name === 'down' || (key.name === 'tab' && !key.shift))) {
        thinkingSelectedIdx = (thinkingSelectedIdx + 1) % thinkingOptions.length;
        renderUI();
        return;
      }
      if (key && (key.name === 'up' || (key.name === 'tab' && key.shift))) {
        thinkingSelectedIdx = (thinkingSelectedIdx - 1 + thinkingOptions.length) % thinkingOptions.length;
        renderUI();
        return;
      }
      if (key && key.name === 'escape') {
        thinkingSelectionVisible = false;
        setIsWaitingResponse(false);
        
        screen.refreshScrollRegion();
        renderUI();
        return;
      }
      if (key && (key.name === 'enter' || key.name === 'return')) {
        const selectedMode = thinkingOptions[thinkingSelectedIdx];
        await driver.setThinkingMode(selectedMode.value);
        
        screen.consoleLog(`[Hệ thống] Đã chuyển sang chế độ suy nghĩ: \x1b[1m${selectedMode.display}\x1b[0m`);
        
        thinkingSelectionVisible = false;
        setIsWaitingResponse(false);
        renderUI();
        return;
      }
      return; // Khóa toàn bộ các phím bấm khác khi đang trong menu chọn chế độ
    }

    // Logic xử lý phím bấm khi menu chọn lịch sử cuộc trò chuyện (History Selection) đang mở
    if (historySelectionVisible) {
      if (key && (key.name === 'down' || (key.name === 'tab' && !key.shift))) {
        historySelectedIdx = (historySelectedIdx + 1) % historyOptions.length;
        renderUI();
        return;
      }
      if (key && (key.name === 'up' || (key.name === 'tab' && key.shift))) {
        historySelectedIdx = (historySelectedIdx - 1 + historyOptions.length) % historyOptions.length;
        renderUI();
        return;
      }
      if (key && key.name === 'escape') {
        historySelectionVisible = false;
        setIsWaitingResponse(false);
        screen.refreshScrollRegion();
        renderUI();
        return;
      }
      if (key && (key.name === 'enter' || key.name === 'return')) {
        const selectedChat = historyOptions[historySelectedIdx];
        if (selectedChat.value !== 'load_more') {
          historySelectionVisible = false;
          setIsWaitingResponse(false);
          renderUI();
        }
        if (currentOnResumeChat) {
          currentOnResumeChat(selectedChat.value);
        }
        return;
      }
      return; // Khóa phím khác
    }

    if (isWaitingResponse) return;

    // 4. Logic điều hướng trong menu Dropdown Autocomplete
    if (autocompleteVisible && autocompleteOptions.length > 0) {
      if (key && (key.name === 'down' || (key.name === 'tab' && !key.shift))) {
        autocompleteSelectedIdx = (autocompleteSelectedIdx + 1) % autocompleteOptions.length;
        renderUI();
        return;
      }
      if (key && (key.name === 'up' || (key.name === 'tab' && key.shift))) {
        autocompleteSelectedIdx = (autocompleteSelectedIdx - 1 + autocompleteOptions.length) % autocompleteOptions.length;
        renderUI();
        return;
      }
      if (key && key.name === 'escape') {
        autocompleteVisible = false;
        
        // Vẽ lại vùng cuộn lịch sử chat khi tắt menu gợi ý
        screen.refreshScrollRegion();
        renderUI();
        return;
      }
      if (key && (key.name === 'enter' || key.name === 'return')) {
        selectAutocompleteOption();
        
        // Vẽ lại vùng cuộn lịch sử chat khi chọn xong gợi ý
        screen.refreshScrollRegion();
        renderUI();
        return;
      }
    }



    // 6. Xử lý Enter gửi tin nhắn chính thức
    if (key && (key.name === 'enter' || key.name === 'return')) {
      const finalInput = inputBuffer;
      const trimmed = finalInput.trim();
      
      // Xử lý các lệnh thay đổi model: /model hoặc /m
      if (trimmed === '/model' || trimmed === '/m') {
        inputBuffer = '';
        cursorOffset = 0;
        
        modelSelectionVisible = true;
        modelSelectedIdx = 0;
        setIsWaitingResponse(true); // Khóa keyboard gõ thường
        
        renderUI();
        return;
      }

      // Xử lý các lệnh thay đổi chế độ suy nghĩ: /mode hoặc /md
      if (trimmed === '/mode' || trimmed === '/md') {
        inputBuffer = '';
        cursorOffset = 0;
        
        thinkingSelectionVisible = true;
        thinkingSelectedIdx = 0;
        setIsWaitingResponse(true); // Khóa keyboard gõ thường
        
        renderUI();
        return;
      }

      inputBuffer = '';
      cursorOffset = 0;
      autocompleteVisible = false;
      
      // Khóa nhập liệu và reset offset cuộn
      setIsWaitingResponse(true);
      screen.setScrollOffset(0);
      
      // Hiển thị câu hỏi của người dùng dưới dạng khối background nổi bật
      const cols = process.stdout.columns || 80;
      const formattedUserPrompt = formatUserPromptBlock(finalInput, cols);
      screen.printInScrollRegion('\n' + formattedUserPrompt + '\n');
      
      await onSendMessage(finalInput);
      return;
    }

    // 7. Phím xóa Backspace
    if (key && key.name === 'backspace') {
      if (cursorOffset > 0) {
        inputBuffer = inputBuffer.slice(0, cursorOffset - 1) + inputBuffer.slice(cursorOffset);
        cursorOffset--;
        checkAutocomplete();
        renderUI();
      }
      return;
    }

    // 8. Phím di chuyển con trỏ Left/Right
    if (key && key.name === 'left') {
      if (cursorOffset > 0) {
        cursorOffset--;
        renderUI();
      }
      return;
    }

    if (key && key.name === 'right') {
      if (cursorOffset < inputBuffer.length) {
        cursorOffset++;
        renderUI();
      }
      return;
    }

    // 9. Phím di chuyển con trỏ Home/End
    if (key && key.name === 'home') {
      cursorOffset = 0;
      renderUI();
      return;
    }

    if (key && key.name === 'end') {
      cursorOffset = inputBuffer.length;
      renderUI();
      return;
    }

    // 9. Nhập chữ viết thông thường
    if (str && !key.ctrl && !key.meta && key.name !== 'escape') {
      if (str === '\r' || str === '\n' || str === '\b') return;
      
      inputBuffer = inputBuffer.slice(0, cursorOffset) + str + inputBuffer.slice(cursorOffset);
      cursorOffset += str.length;
      
      // Nhập chữ tự động quay về cuối màn hình
      screen.setScrollOffset(0);
      
      autoDetectDraggedPaths();
      checkAutocomplete();
      renderUI();
    }
  });
}

module.exports = {
  renderUI,
  setupTerminalInput,
  setIsWaitingResponse,
  showHistorySelection,
  formatUserPromptBlock
};
