'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const driver = require('../driver');
const screen = require('./screen');

let isWaitingResponse = false;
let inputBuffer = '';
let cursorOffset = 0;

let autocompleteVisible = false;
let autocompleteOptions = [];
let autocompleteSelectedIdx = 0;
let autocompleteQuery = '';
let autocompleteIndex = -1;

// Trạng thái menu chọn mô hình (Model Selection)
let modelSelectionVisible = false;
let modelSelectedIdx = 0;
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
  { display: '/websearch (Bật/tắt Tìm kiếm Web)', value: '/websearch' },
  { display: '/ws (Bật/tắt Tìm kiếm Web)', value: '/ws' },
  { display: '/exit (Thoát ứng dụng)', value: '/exit' }
];

let lastMenuLength = 0;

// Hàm vẽ giao diện Terminal Custom Prompt, Dropdown Autocomplete & Model Selector
function renderUI() {
  const rows = process.stdout.rows || 24;

  // 1. Dọn dẹp các dòng menu cũ
  const currentMenuLength = modelSelectionVisible 
    ? modelOptions.length 
    : (autocompleteVisible && autocompleteOptions.length > 0 ? autocompleteOptions.length : 0);
  
  if (lastMenuLength > currentMenuLength) {
    for (let i = currentMenuLength; i < lastMenuLength; i++) {
      const lineRow = rows - 1 - lastMenuLength + i;
      process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
    }
  }
  lastMenuLength = currentMenuLength;

  // 2. Vẽ dòng nhập liệu chính ghim ở dòng áp chót (rows - 1)
  process.stdout.write(`\x1b[${rows - 1};1H\x1b[K`);
  process.stdout.write(`\x1b[1m[You]:\x1b[0m ${inputBuffer}`);

  // 3. Vẽ thanh trạng thái (Status Bar) ghim ở dòng cuối cùng (rows)
  process.stdout.write(`\x1b[${rows};1H\x1b[K`);
  const searchStatus = driver.getWebSearch() ? 'BẬT' : 'TẮT';
  
  // Trích xuất tên hiển thị của model hiện tại
  const currentModelVal = driver.getModelName();
  const matchedModel = modelOptions.find(m => m.value === currentModelVal);
  const modelDisplayName = matchedModel ? matchedModel.display.split(' ')[0] : currentModelVal;
  
  process.stdout.write(`\x1b[36mBuild\x1b[0m · \x1b[2mQwen Chat CLI\x1b[0m · Tìm kiếm Web: \x1b[1m${searchStatus}\x1b[0m · Model: \x1b[1m${modelDisplayName}\x1b[0m`);

  // 4. Vẽ menu chọn mô hình (Model Selector) nổi bật bằng màu nền (không râu ria viền, căng full chiều ngang)
  if (modelSelectionVisible) {
    const cols = process.stdout.columns || 80;
    const contentWidth = Math.max(40, cols - 6); // Trừ đi khoảng lề trái/phải an toàn
    
    modelOptions.forEach((opt, idx) => {
      const lineRow = rows - 1 - modelOptions.length + idx;
      process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
      
      const isSelected = idx === modelSelectedIdx;
      // Dùng padEnd để kéo dài phần nền màu có cùng độ rộng cho tất cả các dòng
      const paddedText = opt.display.padEnd(contentWidth - 3, ' ');
      
      if (isSelected) {
        // Dòng được chọn: Nền cam chữ đen
        process.stdout.write(`  \x1b[48;5;208m\x1b[30m ❯ ${paddedText} \x1b[0m`);
      } else {
        // Dòng không được chọn: Nền xám tối chữ xám sáng để tạo block thống nhất
        process.stdout.write(`  \x1b[48;5;236m\x1b[37m   ${paddedText} \x1b[0m`);
      }
    });
  }
  // 5. Vẽ menu gợi ý dropdown tệp tin (không râu ria viền, căng full chiều ngang)
  else if (autocompleteVisible && autocompleteOptions.length > 0) {
    const menuLength = autocompleteOptions.length;
    const cols = process.stdout.columns || 80;
    const contentWidth = Math.max(40, cols - 6); // Trừ đi khoảng lề trái/phải an toàn
    
    autocompleteOptions.forEach((opt, idx) => {
      const lineRow = rows - 1 - menuLength + idx;
      process.stdout.write(`\x1b[${lineRow};1H\x1b[K`);
      
      const isSelected = idx === autocompleteSelectedIdx;
      const paddedText = opt.display.padEnd(contentWidth - 3, ' ');
      
      if (isSelected) {
        // Dòng được chọn: Nền cam chữ đen
        process.stdout.write(`  \x1b[48;5;208m\x1b[30m ❯ ${paddedText} \x1b[0m`);
      } else {
        // Dòng không được chọn: Nền xám tối chữ xám sáng để tạo block thống nhất
        process.stdout.write(`  \x1b[48;5;236m\x1b[37m   ${paddedText} \x1b[0m`);
      }
    });
  }

  // 6. Đặt vị trí con trỏ nhấp nháy đúng cột đang gõ ở dòng rows-1 (label "[You]: " dài 7 ký tự)
  process.stdout.write(`\x1b[${rows - 1};${7 + cursorOffset + 1}H`);
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
  const prefix = ' [You]: ';
  const lines = text.split('\n');
  const resultLines = [];
  
  let isFirstLine = true;
  for (let line of lines) {
    let startIdx = 0;
    while (startIdx < line.length || (startIdx === 0 && line.length === 0)) {
      const chunkLimit = isFirstLine ? (contentWidth - prefix.length) : contentWidth;
      const chunk = line.slice(startIdx, startIdx + chunkLimit);
      startIdx += chunkLimit;
      
      const lineText = isFirstLine ? (prefix + chunk) : (' '.repeat(prefix.length) + chunk);
      const paddedLine = lineText.padEnd(contentWidth, ' ');
      resultLines.push(`  \x1b[48;5;236m\x1b[37m${paddedLine}\x1b[0m`);
      
      isFirstLine = false;
      if (line.length === 0) break;
    }
  }
  
  return resultLines.join('\n') + '\n';
}

// Đăng ký sự kiện lắng nghe bàn phím
function setupTerminalInput(onSendMessage) {
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

    // 2. Phím cuộn trang PageUp/PageDown
    if (key && key.name === 'pageup') {
      screen.setScrollOffset(screen.getScrollOffset() + 5);
      screen.refreshScrollRegion();
      renderUI();
      return;
    }
    if (key && key.name === 'pagedown') {
      screen.setScrollOffset(Math.max(0, screen.getScrollOffset() - 5));
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
        isWaitingResponse = false;
        
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
        isWaitingResponse = false;
        renderUI();
        return;
      }
      return; // Khóa toàn bộ các phím bấm khác khi đang trong menu chọn model
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

    // 5. Phím Mũi tên Lên/Xuống khi ô nhập liệu trống để cuộn dòng lịch sử
    if (key && key.name === 'up' && !autocompleteVisible && inputBuffer === '') {
      screen.setScrollOffset(screen.getScrollOffset() + 1);
      screen.refreshScrollRegion();
      renderUI();
      return;
    }
    if (key && key.name === 'down' && !autocompleteVisible && inputBuffer === '') {
      screen.setScrollOffset(Math.max(0, screen.getScrollOffset() - 1));
      screen.refreshScrollRegion();
      renderUI();
      return;
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
        isWaitingResponse = true; // Khóa keyboard gõ thường
        
        renderUI();
        return;
      }

      inputBuffer = '';
      cursorOffset = 0;
      autocompleteVisible = false;
      
      // Khóa nhập liệu và reset offset cuộn
      isWaitingResponse = true;
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
  setIsWaitingResponse: (val) => { isWaitingResponse = val; }
};
