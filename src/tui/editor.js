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
let lastStatusBarHeight = 1;

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

// Danh sách model dự phòng (dùng khi chưa tải được từ server)
let modelOptions = [
  // Thế hệ 3.7
  { display: 'Qwen3.7-Plus', value: 'qwen3.7-plus' },
  { display: 'Qwen3.7-Max', value: 'qwen3.7-max' },

  // Thế hệ 3.6
  { display: 'Qwen3.6-Plus', value: 'qwen3.6-plus' },
  { display: 'Qwen3.6-Max-Preview', value: 'qwen3.6-max-preview' },

  // Thế hệ 3.5
  { display: 'Qwen3.5-Plus', value: 'qwen3.5-plus' },
  { display: 'Qwen3.5-Max-Preview', value: 'qwen3.5-max-2026-03-08' },
  { display: 'Qwen3.5-Omni-Plus', value: 'qwen3.5-omni-plus' },
  { display: 'Qwen3.5-Flash', value: 'qwen3.5-flash' },
  { display: 'Qwen3.5-Omni-Flash', value: 'qwen3.5-omni-flash' },

  // Thế hệ Qwen3
  { display: 'Qwen3-Max', value: 'qwen3-max-2026-01-23' },
  { display: 'Qwen3-Coder', value: 'qwen3-coder-plus' },
  { display: 'Qwen3-VL-235B-A22B', value: 'qwen3-vl-plus' },
  { display: 'Qwen3-Omni-Flash', value: 'qwen3-omni-flash-2025-12-01' }
];

/**
 * Cập nhật danh sách model động (gọi từ cli.js sau khi lấy được từ server).
 * @param {Array<{display:string, value:string}>} newModels
 */
function setModelOptions(newModels) {
  if (!Array.isArray(newModels) || newModels.length === 0) return;
  modelOptions = newModels;
  // Reset selection về đầu để tránh index out-of-bounds
  modelSelectedIdx = 0;
}

function getModelOptions() {
  return modelOptions;
}

const slashCommands = [
  { display: '/model (Thay đổi mô hình chat)', value: '/model' },
  { display: '/m (Thay đổi mô hình chat)', value: '/m' },
  { display: '/mode (Thay đổi chế độ suy nghĩ)', value: '/mode' },
  { display: '/md (Thay đổi chế độ suy nghĩ)', value: '/md' },
  { display: '/detail (Bật/tắt hiển thị suy nghĩ chi tiết)', value: '/detail' },
  { display: '/dt (Bật/tắt hiển thị suy nghĩ chi tiết)', value: '/dt' },
  { display: '/websearch (Bật/tắt Tìm kiếm Web)', value: '/websearch' },
  { display: '/ws (Bật/tắt Tìm kiếm Web)', value: '/ws' },
  { display: '/copy (Sao chép phản hồi mới nhất)', value: '/copy' },
  { display: '/c (Sao chép phản hồi mới nhất)', value: '/c' },
  { display: '/clear (Xóa màn hình hiển thị TUI)', value: '/clear' },
  { display: '/resume (Tiếp tục chat từ lịch sử)', value: '/resume' },
  { display: '/rs (Tiếp tục chat từ lịch sử)', value: '/rs' },
  { display: '/new (Tạo cuộc trò chuyện mới)', value: '/new' },
  { display: '/export (Bật/tắt tự động xuất chat)', value: '/export' },
  { display: '/ep (Bật/tắt tự động xuất chat)', value: '/ep' },
  { display: '/import (Nhập lịch sử chat từ file)', value: '/import' },
  { display: '/ip (Nhập lịch sử chat từ file)', value: '/ip' },
  { display: '/update (Cập nhật ứng dụng lên bản mới nhất)', value: '/update' },
  { display: '/up (Cập nhật ứng dụng lên bản mới nhất)', value: '/up' },
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

function calculateCursorPosition(cols) {
  const segments = getWrappedSegments(inputBuffer, cols);
  let cursorLineIdx = 0;
  let cursorCol = 0;
  
  const firstLineLimit = cols - 5;
  if (cursorOffset <= firstLineLimit) {
    cursorLineIdx = 0;
    cursorCol = 5 + cursorOffset;
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
  return { segments, cursorLineIdx, cursorCol, promptLinesCount };
}

function renderBoxedMenu(rows, promptLinesCount, statusBarHeight, items, selectedIdx, title, getDisplay, maxVisible = 12) {
  const terminalRows = rows || process.stdout.rows || 24;
  const terminalCols = process.stdout.columns || 80;
  const boxWidth = Math.max(40, terminalCols - 8);
  const textWidth = boxWidth - 8;

  let startIdx = 0;
  if (items.length > maxVisible) {
    startIdx = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
    if (startIdx + maxVisible > items.length) {
      startIdx = items.length - maxVisible;
    }
  }
  const visibleItems = items.slice(startIdx, startIdx + maxVisible);
  const visibleSelectedIdx = selectedIdx - startIdx;
  const menuLength = visibleItems.length;

  // 1. Draw Top Border
  const topBorderRow = terminalRows - statusBarHeight - (promptLinesCount - 1) - (menuLength + 2);
  process.stdout.write(`\x1b[${topBorderRow};1H\x1b[K`);
  process.stdout.write(drawTopBorder(boxWidth, title));

  // 2. Draw Items
  visibleItems.forEach((item, idx) => {
    const lineRow = topBorderRow + 1 + idx;
    process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
    
    const isSelected = idx === visibleSelectedIdx;
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
  const bottomBorderRow = topBorderRow + 1 + menuLength;
  process.stdout.write(`\x1b[${bottomBorderRow};1H\x1b[K`);
  process.stdout.write('  └' + '─'.repeat(boxWidth - 4) + '┘');
}

function renderStatusBarOnly(statusBarHeight = 1) {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  
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

  const exportStatus = driver.isExportModeEnabled()
    ? '\x1b[1m\x1b[32mBẬT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m'
    : '\x1b[2mTẮT\x1b[0m\x1b[48;5;235m\x1b[38;5;250m';
  
  const ansiRegex = /\u001b\[[0-9;]*m/g;

  if (statusBarHeight === 2) {
    const isCompact = cols < 70;
    const searchLabel = isCompact ? '🌐 Web:' : '🌐 Tìm kiếm:';
    const thinkingLabel = isCompact ? '🧠' : '🧠 Suy nghĩ:';
    const detailedLabel = isCompact ? '⚙️' : '⚙️ Chi tiết:';
    const modelLabel = isCompact ? '🤖' : '🤖 Model:';
    const exportLabel = isCompact ? '💾' : '💾 Xuất:';

    const line1Items = [];
    if (cols >= 65) {
      line1Items.push(`💻 Qwen CLI`);
    }
    line1Items.push(`${searchLabel} ${searchStatus}`);
    line1Items.push(`${thinkingLabel} ${thinkingDisplay}`);
    const line1Text = ' ' + line1Items.join(' │ ') + ' ';
    const line1VisibleLen = line1Text.replace(ansiRegex, '').length;
    const line1Padding = Math.max(0, cols - line1VisibleLen);

    const line2Items = [
      `${detailedLabel} ${detailedStatus}`,
      `${modelLabel} ${modelDisplay}`,
      `${exportLabel} ${exportStatus}`
    ];
    const line2Text = ' ' + line2Items.join(' │ ') + ' ';
    const line2VisibleLen = line2Text.replace(ansiRegex, '').length;
    const line2Padding = Math.max(0, cols - line2VisibleLen);

    // Draw Line 1 at rows - 1
    process.stdout.write(`\x1b[${rows - 1};1H\x1b[K`);
    process.stdout.write(`\x1b[48;5;235m\x1b[38;5;250m${line1Text}${' '.repeat(line1Padding)}\x1b[0m`);

    // Draw Line 2 at rows
    process.stdout.write(`\x1b[${rows};1H\x1b[K`);
    process.stdout.write(`\x1b[48;5;235m\x1b[38;5;250m${line2Text}${' '.repeat(line2Padding)}\x1b[0m`);
  } else {
    // Single line status bar
    const lineItems = [];
    if (cols >= 120) {
      lineItems.push(`💻 Qwen CLI`);
    }
    lineItems.push(`🌐 Tìm kiếm: ${searchStatus}`);
    lineItems.push(`🧠 Suy nghĩ: ${thinkingDisplay}`);
    if (cols >= 95) {
      lineItems.push(`⚙️ Chi tiết: ${detailedStatus}`);
    }
    lineItems.push(`🤖 Model: ${modelDisplay}`);
    lineItems.push(`💾 Xuất: ${exportStatus}`);

    const lineText = ' ' + lineItems.join(' │ ') + ' ';
    const lineVisibleLen = lineText.replace(ansiRegex, '').length;
    const linePadding = Math.max(0, cols - lineVisibleLen);

    process.stdout.write(`\x1b[${rows};1H\x1b[K`);
    process.stdout.write(`\x1b[48;5;235m\x1b[38;5;250m${lineText}${' '.repeat(linePadding)}\x1b[0m`);
  }

  // Phục hồi con trỏ gõ
  const { cursorLineIdx, cursorCol, promptLinesCount } = calculateCursorPosition(cols);
  const startRow = rows - statusBarHeight - (promptLinesCount - 1);
  const cursorRow = startRow + cursorLineIdx;
  process.stdout.write(`\x1b[${cursorRow};${cursorCol + 1}H`);
}

function getWrappedSegments(input, cols) {
  const prefixLen = 5;
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

  // Tính toán độ cao thanh trạng thái động (nếu màn hình hẹp thì hiển thị 2 dòng)
  const statusBarHeight = cols < 95 ? 2 : 1;
  screen.setStatusBarHeight(statusBarHeight);

  // Tính toán số dòng của prompt hiện tại và vị trí con trỏ
  const { segments, cursorLineIdx, cursorCol, promptLinesCount } = calculateCursorPosition(cols);
  screen.setPromptLinesCount(promptLinesCount);

  // 1. Dọn dẹp các dòng menu cũ dựa trên vị trí cũ
  const currentMenuLength = modelSelectionVisible 
    ? Math.min(12, modelOptions.length) + 2
    : (thinkingSelectionVisible
      ? Math.min(12, thinkingOptions.length) + 2
      : (autocompleteVisible && autocompleteOptions.length > 0 
         ? Math.min(12, autocompleteOptions.length) + 2
         : (historySelectionVisible 
            ? Math.min(10, historyOptions.length) + 2 
            : 0)));
  
  const prevMenuStart = rows - lastStatusBarHeight - (lastPromptLinesCount - 1) - lastMenuLength;
  const currentMenuStart = rows - statusBarHeight - (promptLinesCount - 1) - currentMenuLength;
  
  const clearStartRow = Math.min(prevMenuStart, currentMenuStart);
  const clearEndRow = rows - statusBarHeight - (promptLinesCount - 1) - 1;
  
  for (let r = clearStartRow; r <= clearEndRow; r++) {
    process.stdout.write(`\x1b[${r};1H\x1b[K`);
  }
  
  lastMenuLength = currentMenuLength;
  lastPromptLinesCount = promptLinesCount;
  lastStatusBarHeight = statusBarHeight;

  // 2. Vẽ các dòng của prompt (ghim ở dưới cùng trước status bar)
  const startRow = rows - statusBarHeight - (promptLinesCount - 1);
  for (let i = 0; i < promptLinesCount; i++) {
    const lineRow = startRow + i;
    process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
    if (i === 0) {
      process.stdout.write(`\x1b[1m\x1b[38;5;75mBạn:\x1b[0m ${segments[0] || ''}`);
    } else {
      process.stdout.write(segments[i] || '');
    }
  }

  // 3. Vẽ thanh trạng thái (Status Bar) ghim ở dưới cùng
  renderStatusBarOnly(statusBarHeight);

  // 4. Vẽ menu chọn mô hình (Model Selector) nổi bật bằng khung viền
  if (modelSelectionVisible) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      statusBarHeight,
      modelOptions,
      modelSelectedIdx,
      ' Chọn Mô Hình ',
      (opt) => opt.display,
      12
    );
  }
  // Vẽ menu chọn chế độ suy nghĩ (Thinking Selector)
  else if (thinkingSelectionVisible) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      statusBarHeight,
      thinkingOptions,
      thinkingSelectedIdx,
      ' Chế Độ Suy Nghĩ ',
      (opt) => opt.display,
      12
    );
  }
  // 5. Vẽ menu gợi ý dropdown tệp tin hoặc câu lệnh
  else if (autocompleteVisible && autocompleteOptions.length > 0) {
    const isCommand = autocompleteOptions[0] && autocompleteOptions[0].isCommand;
    renderBoxedMenu(
      rows,
      promptLinesCount,
      statusBarHeight,
      autocompleteOptions,
      autocompleteSelectedIdx,
      isCommand ? ' Danh Sách Lệnh ' : ' Gợi Ý Tệp Tin ',
      (opt) => opt.display,
      12
    );
  }
  // Vẽ menu chọn lịch sử (History Selector)
  else if (historySelectionVisible) {
    renderBoxedMenu(
      rows,
      promptLinesCount,
      statusBarHeight,
      historyOptions,
      historySelectedIdx,
      ' Lịch Sử Cuộc Trò Chuyện ',
      (opt) => opt.display,
      10
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
        const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
        
        autocompleteOptions = entries
          .filter(entry => {
            if (['node_modules', '.git', 'debug', 'references'].includes(entry.name)) return false;
            return entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase());
          })
          .slice(0, 20)
          .map(entry => {
            const isDir = entry.isDirectory();
            const relPath = searchDir === '.' ? entry.name : `${searchDir}/${entry.name}`;
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
      .slice(0, 20)
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
  const linuxPathRegex = /(?:^|\s)(?:(['"])(\/[^'"]+)\1|(\/(?:[^\s'"]|\\ )+))(?=$|\s)/g;
  const windowsPathRegex = /(?:^|\s)(?:(['"])([a-zA-Z]:\\[^'"]+)\1|([a-zA-Z]:\\(?:[^\s'"]|\\ )+))(?=$|\s)/g;
  
  let changed = false;

  const replaceFn = (match, quote, quotedPath, unquotedPath) => {
    const rawPath = quotedPath || unquotedPath;
    if (!rawPath) return match;
    let cleanPath = rawPath.replace(/\\ /g, ' ').trim();
    
    const trimmedMatch = match.trim();
    if (trimmedMatch.startsWith('@') || trimmedMatch.startsWith('"@') || trimmedMatch.startsWith("'@")) {
      return match;
    }

    try {
      if (fs.existsSync(cleanPath)) {
        changed = true;
        const leadingSpace = match.startsWith(' ') ? ' ' : '';
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
    
    autocompleteVisible = false;
    autocompleteOptions = [];
    autocompleteSelectedIdx = 0;
    
    renderUI();
  }
}

// Định dạng câu hỏi của người dùng thành một khối có màu nền giống menu /model
function formatUserPromptBlock(text, cols) {
  const contentWidth = Math.max(30, cols - 6); 
  const prefix = '   Bạn: ';
  const lines = text.split('\n');
  const resultLines = [];
  
  let isFirstLine = true;
  for (let line of lines) {
    let currentLine = line;
    const chunkLimit = contentWidth - prefix.length;
    
    while (currentLine.length > 0 || (isFirstLine && line.length === 0)) {
      let chunk = '';
      if (currentLine.length <= chunkLimit) {
        chunk = currentLine;
        currentLine = '';
      } else {
        let splitIdx = currentLine.lastIndexOf(' ', chunkLimit);
        if (splitIdx <= 0) {
          splitIdx = chunkLimit;
        }
        chunk = currentLine.slice(0, splitIdx);
        currentLine = currentLine.slice(splitIdx).trimStart();
      }

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
          if (currentOnResumeChat) {
            currentOnResumeChat(selectedChat.value);
          }
        } else {
          if (currentOnResumeChat) {
            currentOnResumeChat('load_more');
          }
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
  formatUserPromptBlock,
  setModelOptions,
  getModelOptions
};
