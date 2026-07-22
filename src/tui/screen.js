'use strict';

const driver = require('../driver');

// Trạng thái vùng cuộn
let scrollContentBuffer = '';
let scrollOffset = 0;

// Callback dùng để render ô nhập liệu khi cuộn/resize màn hình
let renderUICallback = () => {};
let promptLinesCount = 1;
let statusBarHeight = 1;

let resizeCallback = null;

function setResizeCallback(cb) {
  resizeCallback = cb;
}

let thinkingSpinnerInterval = null;
let thinkingSpinnerIndex = 0;
let hasThinkingSpinner = false;

function startThinkingSpinner() {
  if (thinkingSpinnerInterval) return;
  
  scrollContentBuffer += '⠋';
  hasThinkingSpinner = true;
  thinkingSpinnerIndex = 0;
  
  refreshScrollRegion();
  renderUICallback();
  
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  
  thinkingSpinnerInterval = setInterval(() => {
    if (!hasThinkingSpinner) return;
    thinkingSpinnerIndex = (thinkingSpinnerIndex + 1) % spinnerFrames.length;
    
    if (scrollContentBuffer.length > 0) {
      scrollContentBuffer = scrollContentBuffer.slice(0, -1) + spinnerFrames[thinkingSpinnerIndex];
      refreshScrollRegion();
      renderUICallback();
    }
  }, 80);
}

function stopThinkingSpinner() {
  if (thinkingSpinnerInterval) {
    clearInterval(thinkingSpinnerInterval);
    thinkingSpinnerInterval = null;
  }
  
  if (hasThinkingSpinner) {
    if (scrollContentBuffer.length > 0) {
      const isDetailed = driver.isDetailedThinking();
      const replacement = isDetailed ? '' : ' \x1b[38;5;244m(Hoàn tất)\x1b[0m';
      scrollContentBuffer = scrollContentBuffer.slice(0, -1) + replacement;
    }
    hasThinkingSpinner = false;
    refreshScrollRegion();
    renderUICallback();
  }
}

function setPromptLinesCount(count) {
  if (promptLinesCount !== count) {
    promptLinesCount = count;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${rows - statusBarHeight - promptLinesCount}r`);
    refreshScrollRegion();
  }
}

function setStatusBarHeight(height) {
  if (statusBarHeight !== height) {
    statusBarHeight = height;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${rows - statusBarHeight - promptLinesCount}r`);
    refreshScrollRegion();
  }
}

function setRenderUICallback(cb) {
  renderUICallback = cb;
}

let lastMaxLinesCleared = 0;

function wrapLineToCols(line, cols) {
  if (!cols || cols <= 0) cols = 80;
  const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  const clean = line.replace(ansiRegex, '');
  if (clean.length <= cols) {
    return [line];
  }

  const result = [];
  let currentChunk = '';
  let currentWidth = 0;
  let activeAnsi = '';

  let i = 0;
  while (i < line.length) {
    if (line[i] === '\x1b') {
      const match = line.slice(i).match(/^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/);
      if (match) {
        const ansiSeq = match[0];
        currentChunk += ansiSeq;
        if (ansiSeq === '\x1b[0m') {
          activeAnsi = '';
        } else {
          activeAnsi += ansiSeq;
        }
        i += ansiSeq.length;
        continue;
      }
    }

    currentChunk += line[i];
    currentWidth++;
    i++;

    if (currentWidth >= cols) {
      if (activeAnsi) currentChunk += '\x1b[0m';
      result.push(currentChunk);
      currentChunk = activeAnsi;
      currentWidth = 0;
    }
  }

  if (currentWidth > 0 || currentChunk.replace(ansiRegex, '').length > 0) {
    result.push(currentChunk);
  }

  return result.length > 0 ? result : [''];
}

// Hàm vẽ lại vùng cuộn dựa trên chiều cao terminal hiện tại và scrollOffset
function refreshScrollRegion() {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const maxLines = Math.max(1, rows - statusBarHeight - promptLinesCount); // Chiều cao tối đa của vùng cuộn

  const rawLines = scrollContentBuffer.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const allLines = [];
  rawLines.forEach((line) => {
    const wrapped = wrapLineToCols(line, cols);
    allLines.push(...wrapped);
  });

  // Giới hạn scrollOffset trong phạm vi hợp lệ
  const maxScroll = Math.max(0, allLines.length - maxLines);
  if (scrollOffset > maxScroll) scrollOffset = maxScroll;
  if (scrollOffset < 0) scrollOffset = 0;

  // Cắt danh sách các dòng cần hiển thị
  const startIdx = Math.max(0, allLines.length - maxLines - scrollOffset);
  const endIdx = allLines.length - scrollOffset;
  const visibleLines = allLines.slice(startIdx, endIdx);

  // 1. Xóa sạch vùng cuộn (tính cả chiều cao vùng cũ để tránh đọng lại artifact)
  const clearLimit = Math.max(maxLines, lastMaxLinesCleared);
  lastMaxLinesCleared = maxLines;

  for (let i = 1; i <= clearLimit; i++) {
    process.stdout.write(`\x1b[${i};1H\x1b[K`);
  }

  // 2. Vẽ các dòng văn bản hiển thị lên vùng cuộn
  visibleLines.forEach((line, idx) => {
    process.stdout.write(`\x1b[${idx + 1};1H${line}`);
  });

  // 3. Đặt con trỏ in ấn ở dòng rows - statusBarHeight - promptLinesCount và lưu lại vị trí
  process.stdout.write(`\x1b[${maxLines};1H\x1b[s`);
}

function capScrollBuffer() {
  const maxBufferLines = 5000;
  if (scrollContentBuffer.length > 500000) {
    const lines = scrollContentBuffer.split('\n');
    if (lines.length > maxBufferLines) {
      scrollContentBuffer = lines.slice(lines.length - maxBufferLines).join('\n');
    }
  }
}

// Hàm in nội dung an toàn vào Vùng cuộn (Scroll Region)
function printInScrollRegion(text) {
  if (hasThinkingSpinner && scrollContentBuffer.length > 0) {
    const spinnerChar = scrollContentBuffer.slice(-1);
    scrollContentBuffer = scrollContentBuffer.slice(0, -1);
    const lines = (scrollContentBuffer + text).split('\n');
    lines[lines.length - 1] += spinnerChar;
    scrollContentBuffer = lines.join('\n');
  } else {
    scrollContentBuffer += text;
  }
  
  capScrollBuffer();

  if (scrollOffset === 0) {
    refreshScrollRegion();
  }
  
  renderUICallback();
}

function consoleLog(text) {
  printInScrollRegion(text + '\n');
}

function consoleError(text) {
  printInScrollRegion(`\x1b[31m${text}\x1b[0m\n`);
}

let originalLog = console.log;
let originalWarn = console.warn;
let originalError = console.error;

// Khởi tạo Alternate Screen Buffer và Scrolling Region
function initTUI() {
  const rows = process.stdout.rows || 24;
  
  process.stdout.write('\x1b[?1049h'); // Bật Alternate Screen Buffer
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // Xóa sạch màn hình đệm
  process.stdout.write(`\x1b[1;${rows - statusBarHeight - promptLinesCount}r`); // Khóa vùng cuộn
  process.stdout.write(`\x1b[${rows - statusBarHeight - promptLinesCount};1H\x1b[s`); // Đặt và lưu con trỏ in ấn

  // Chuyển hướng console.log/warn/error để không làm hỏng TUI
  console.log = (...args) => {
    const text = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    consoleLog(text);
  };
  console.warn = (...args) => {
    const text = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    consoleLog(`[Cảnh báo]: ${text}`);
  };
  console.error = (...args) => {
    const text = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    consoleError(text);
  };

  // Lắng nghe sự kiện Resize để co giãn vùng cuộn theo cửa sổ Terminal
  process.stdout.on('resize', () => {
    const r = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${r - statusBarHeight - promptLinesCount}r`);
    if (resizeCallback) {
      resizeCallback();
    } else {
      refreshScrollRegion();
    }
    renderUICallback();
  });
}

// Khôi phục terminal gốc (Normal Screen Buffer) khi thoát chương trình
async function shutdownTUI() {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;

  process.stdout.write('\x1b[r'); // Reset scrolling region
  process.stdout.write('\x1b[?1049l'); // Quay lại Normal Screen Buffer
  await driver.closeBrowser().catch(() => {});
  process.exit(0);
}

module.exports = {
  initTUI,
  shutdownTUI,
  printInScrollRegion,
  refreshScrollRegion,
  consoleLog,
  consoleError,
  setRenderUICallback,
  getScrollOffset: () => scrollOffset,
  setScrollOffset: (val) => { scrollOffset = val; },
  getScrollContentBuffer: () => scrollContentBuffer,
  setScrollContentBuffer: (val) => { scrollContentBuffer = val; },
  setPromptLinesCount,
  setStatusBarHeight,
  startThinkingSpinner,
  stopThinkingSpinner,
  setResizeCallback
};
