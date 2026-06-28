'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const driver = require('./driver');

let isWaitingResponse = false;
let currentResponseText = '';
let hasShownThinkingLabel = false;

// Các biến trạng thái của Custom Terminal Input Editor
let inputBuffer = '';
let cursorOffset = 0;

let autocompleteVisible = false;
let autocompleteOptions = [];
let autocompleteSelectedIdx = 0;
let autocompleteQuery = '';
let autocompleteIndex = -1;

// Hàm phân tích cú pháp dữ liệu SSE (Server-Sent Events)
function parseSSEChunk(rawText) {
  const lines = rawText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const dataJson = trimmed.slice(5).trim();
    if (!dataJson || dataJson === '[DONE]') continue;

    try {
      const parsed = JSON.parse(dataJson);
      const choices = parsed.choices;
      if (choices && choices[0]) {
        const delta = choices[0].delta;
        if (delta) {
          // 1. Phát hiện phase suy nghĩ (thinking_summary)
          if (delta.phase === 'thinking_summary') {
            if (!hasShownThinkingLabel) {
              process.stdout.write('\n[AI Thinking]: ');
              hasShownThinkingLabel = true;
            }
            process.stdout.write('.');
          }
          
          // 2. Phát hiện phase trả lời chính thức (answer)
          if (delta.content && (!delta.phase || delta.phase === 'answer')) {
            if (hasShownThinkingLabel) {
              process.stdout.write('\n\n[AI]: ');
              hasShownThinkingLabel = false;
            }

            const incomingText = delta.content;

            // Thuật toán so khớp thông minh: Tự động phát hiện Cumulative vs Incremental
            if (incomingText.startsWith(currentResponseText) && incomingText.length > currentResponseText.length) {
              const diffText = incomingText.slice(currentResponseText.length);
              process.stdout.write(diffText);
              currentResponseText = incomingText;
            } else if (!incomingText.startsWith(currentResponseText)) {
              process.stdout.write(incomingText);
              currentResponseText += incomingText;
            }
          }
        }
      }
    } catch (e) {
      // Bỏ qua lỗi parse JSON
    }
  }
}

// Trích xuất danh sách file/folder bắt đầu bằng ký tự @ từ nội dung chat
function extractAttachedFiles(inputText) {
  const fileRegex = /@([^\s"'\(\)\[\]\{\}]+)/g;
  const matches = [];
  let match;
  
  while ((match = fileRegex.exec(inputText)) !== null) {
    let cleanPath = match[1];
    if (cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    matches.push(cleanPath);
  }
  
  return [...new Set(matches)];
}

// Quét đệ quy tất cả các file hợp lệ trong thư mục
function getFilesRecursively(dirPath) {
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      
      if (stat && stat.isDirectory()) {
        const baseName = path.basename(fullPath);
        if (['node_modules', '.git', 'debug', 'references'].includes(baseName)) return;
        results = results.concat(getFilesRecursively(fullPath));
      } else {
        const ext = path.extname(fullPath).toLowerCase();
        const validExts = [
          '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.html', 
          '.css', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'
        ];
        if (validExts.includes(ext)) {
          results.push(fullPath);
        }
      }
    });
  } catch (err) {
    console.error(`[Cảnh báo]: Không thể đọc thư mục ${dirPath}: ${err.message}`);
  }
  return results;
}

// Biến Promise dùng để đồng bộ hóa hàng đợi gửi tin nhắn
let resolveDonePromise = null;
function waitForResponse() {
  return new Promise((resolve) => {
    resolveDonePromise = resolve;
  });
}

// Hàm chia mảng thành các nhóm nhỏ (chunks)
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Hàm vẽ giao diện Terminal Custom Prompt & Dropdown Autocomplete
function renderUI() {
  const menuLength = (autocompleteVisible && autocompleteOptions.length > 0) ? autocompleteOptions.length : 0;

  // 1. Quay về đầu dòng và xóa sạch từ con trỏ hiện tại đến hết màn hình
  process.stdout.write('\r\x1b[J');
  
  // 2. Vẽ dòng nhập liệu chính
  process.stdout.write(`\x1b[1m[You]:\x1b[0m ${inputBuffer}`);

  // 3. Vẽ menu gợi ý dropdown bên dưới nếu đang hiển thị
  if (autocompleteVisible && autocompleteOptions.length > 0) {
    process.stdout.write('\n');
    autocompleteOptions.forEach((opt, idx) => {
      const isSelected = idx === autocompleteSelectedIdx;
      // Định dạng màu nền cam chữ đen cho dòng được chọn
      const prefix = isSelected ? '\x1b[48;5;208m\x1b[30m ' : ' ';
      const suffix = isSelected ? ' \x1b[0m' : '';
      process.stdout.write(`${prefix}${opt.display}${suffix}\n`);
    });

    // Di chuyển con trỏ ngược lên dòng nhập liệu chính
    process.stdout.write(`\x1b[${menuLength + 1}A`);
  }

  // 4. Đặt vị trí con trỏ nhấp nháy đúng cột đang gõ (label "[You]: " dài 7 ký tự)
  process.stdout.write(`\x1b[${7 + cursorOffset + 1}G`);
}

// Quét thư mục tìm các file/folder khớp với từ bắt đầu bằng @
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
  }

  autocompleteVisible = false;
  autocompleteOptions = [];
  autocompleteSelectedIdx = 0;
}

// Chọn một tệp tin/thư mục từ dropdown menu
function selectAutocompleteOption() {
  const selectedOpt = autocompleteOptions[autocompleteSelectedIdx];
  if (!selectedOpt) return;

  const textBeforeIdx = inputBuffer.slice(0, autocompleteIndex);
  const textAfterCursor = inputBuffer.slice(cursorOffset);
  
  const insertText = `@${selectedOpt.value}`;
  
  inputBuffer = textBeforeIdx + insertText + ' ' + textAfterCursor;
  cursorOffset = textBeforeIdx.length + insertText.length + 1;
  
  autocompleteVisible = false;
  autocompleteOptions = [];
  autocompleteSelectedIdx = 0;
}

// Xử lý gửi tin nhắn chính thức của người dùng
async function handleUserMessage(inputText) {
  const trimmedInput = inputText.trim();
  if (!trimmedInput) {
    renderUI();
    return;
  }

  // Xử lý lệnh bật/tắt Web Search
  if (trimmedInput === '/websearch' || trimmedInput === '/ws') {
    const currentStatus = driver.getWebSearch();
    const newStatus = !currentStatus;
    await driver.setWebSearch(newStatus);
    console.log(`[Hệ thống] Tìm kiếm Web đã được: ${newStatus ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
    renderUI();
    return;
  }

  // 1. Phân tích các tệp đính kèm @path
  const pathsToProcess = extractAttachedFiles(trimmedInput);
  let allFilesToUpload = [];
  let finalPrompt = trimmedInput;

  if (pathsToProcess.length > 0) {
    console.log(`[Hệ thống] Đang phân tích ${pathsToProcess.length} đường dẫn đính kèm...`);
    
    for (const pathItem of pathsToProcess) {
      const resolvedPath = path.isAbsolute(pathItem) ? path.resolve(pathItem) : path.resolve(process.cwd(), pathItem);
      
      if (!fs.existsSync(resolvedPath)) {
        console.error(`[Lỗi]: Đường dẫn @${pathItem} không tồn tại: ${resolvedPath}`);
        renderUI();
        return;
      }

      const relativePath = path.relative(process.cwd(), resolvedPath);
      const stat = fs.statSync(resolvedPath);
      
      if (stat.isDirectory()) {
        console.log(`[Hệ thống] Đang quét thư mục: @${pathItem}...`);
        const folderFiles = getFilesRecursively(resolvedPath);
        console.log(`[Hệ thống] Quét xong. Tìm thấy ${folderFiles.length} file hợp lệ trong thư mục.`);
        allFilesToUpload = allFilesToUpload.concat(folderFiles);

        const safeNames = folderFiles.map(f => {
          const relF = path.relative(process.cwd(), f);
          return relF.replace(new RegExp('\\' + path.sep, 'g'), '--').replace(/[^a-zA-Z0-9_.-]/g, '_');
        });
        
        const replacement = `@${pathItem} (thư mục chứa các tệp đã tải lên: ${safeNames.join(', ')})`;
        finalPrompt = finalPrompt.replace(new RegExp(`@${pathItem}/?`, 'g'), replacement);
      } else {
        allFilesToUpload.push(resolvedPath);

        const safeRelativeName = relativePath
          .replace(new RegExp('\\' + path.sep, 'g'), '--')
          .replace(/[^a-zA-Z0-9_.-]/g, '_');

        const replacement = `@${pathItem} (được tải lên với tên: ${safeRelativeName})`;
        finalPrompt = finalPrompt.replace(new RegExp(`@${pathItem}`, 'g'), replacement);
      }
    }
    
    allFilesToUpload = [...new Set(allFilesToUpload)];
    console.log(`[Hệ thống] Tổng số file đính kèm cần gửi lên: ${allFilesToUpload.length} file.`);
  }

  // 2. Chia nhóm upload dần dần nếu nhiều hơn 5 file
  if (allFilesToUpload.length > 5) {
    console.log(`[Hệ thống] Do Qwen giới hạn 5 file/lượt, hệ thống sẽ tự động chia thành các nhóm để tải lên dần dần...`);
    
    const fileChunks = chunkArray(allFilesToUpload, 5);
    const totalChunks = fileChunks.length;

    for (let i = 0; i < totalChunks - 1; i++) {
      const currentChunk = fileChunks[i];
      const chunkIndex = i + 1;
      
      console.log(`\n[Hệ thống] Đang chuẩn bị nhóm file ${chunkIndex}/${totalChunks} (Gồm ${currentChunk.length} file)...`);
      
      for (const filePath of currentChunk) {
        try {
          await driver.uploadFile(filePath);
        } catch (err) {
          console.error(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
          renderUI();
          return;
        }
      }

      isWaitingResponse = true;
      currentResponseText = '';
      hasShownThinkingLabel = false;

      const silentPrompt = `[Hệ thống] Đây là nhóm tệp đính kèm thứ ${chunkIndex} trên tổng số ${totalChunks}. Vui lòng ghi nhớ và phân tích nội dung các tệp này để chuẩn bị trả lời câu hỏi tiếp theo.`;
      console.log(`[Hệ thống] Gửi thông tin nhóm ${chunkIndex}/${totalChunks} lên Qwen...`);
      
      try {
        await driver.sendPrompt(silentPrompt);
        await waitForResponse();
      } catch (err) {
        console.error(`\n[Lỗi gửi nhóm file]: ${err.message}`);
        isWaitingResponse = false;
        renderUI();
        return;
      }
    }

    const lastChunk = fileChunks[totalChunks - 1];
    console.log(`\n[Hệ thống] Đang tải lên nhóm file cuối cùng ${totalChunks}/${totalChunks} (Gồm ${lastChunk.length} file)...`);
    
    for (const filePath of lastChunk) {
      try {
        await driver.uploadFile(filePath);
      } catch (err) {
        console.error(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
        renderUI();
        return;
      }
    }
  } else if (allFilesToUpload.length > 0) {
    for (const filePath of allFilesToUpload) {
      try {
        await driver.uploadFile(filePath);
      } catch (err) {
        console.error(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
        renderUI();
        return;
      }
    }
  }

  // 3. Gửi prompt chính thức
  isWaitingResponse = true;
  currentResponseText = '';
  hasShownThinkingLabel = false;

  const searchStatus = driver.getWebSearch() ? 'BẬT' : 'TẮT';
  console.log(`\n[Hệ thống] Gửi yêu cầu chính thức (Tìm kiếm Web: ${searchStatus})...`);

  try {
    await driver.sendPrompt(finalPrompt);
  } catch (err) {
    console.error(`\n[Lỗi gửi tin nhắn]: ${err.message}`);
    isWaitingResponse = false;
    renderUI();
  }
}

// Đăng ký sự kiện lắng nghe bàn phím
function setupTerminalInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', async (str, key) => {
    // 1. Phím tắt ctrl+c để đóng trình duyệt và thoát chương trình sạch sẽ
    if (key && key.ctrl && key.name === 'c') {
      console.log('\nĐang thoát chương trình...');
      await driver.closeBrowser();
      process.exit(0);
    }

    if (isWaitingResponse) return;

    // 2. Logic điều hướng trong menu Dropdown Autocomplete
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
        renderUI();
        return;
      }
      if (key && (key.name === 'enter' || key.name === 'return')) {
        selectAutocompleteOption();
        renderUI();
        return;
      }
    }

    // 3. Xử lý Enter gửi tin nhắn chính thức
    if (key && (key.name === 'enter' || key.name === 'return')) {
      const finalInput = inputBuffer;
      inputBuffer = '';
      cursorOffset = 0;
      autocompleteVisible = false;
      
      process.stdout.write('\n'); // Xuống dòng trước khi ghi logs
      await handleUserMessage(finalInput);
      return;
    }

    // 4. Phím xóa Backspace
    if (key && key.name === 'backspace') {
      if (cursorOffset > 0) {
        inputBuffer = inputBuffer.slice(0, cursorOffset - 1) + inputBuffer.slice(cursorOffset);
        cursorOffset--;
        checkAutocomplete();
        renderUI();
      }
      return;
    }

    // 5. Phím di chuyển con trỏ Left/Right
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

    // 6. Nhập chữ viết thông thường
    if (str && !key.ctrl && !key.meta && key.name !== 'escape') {
      // Bỏ qua các ký tự điều khiển/lùi dòng không hợp lệ
      if (str === '\r' || str === '\n' || str === '\b') return;
      
      inputBuffer = inputBuffer.slice(0, cursorOffset) + str + inputBuffer.slice(cursorOffset);
      cursorOffset += str.length;
      checkAutocomplete();
      renderUI();
    }
  });
}

async function main() {
  console.log('=== QWEN CHAT CLI ===');
  console.log('Nhập "/exit" hoặc nhấn Ctrl+C để thoát chương trình.');
  console.log('Nhập "/websearch" hoặc "/ws" để bật/tắt Tìm kiếm Web (Mặc định: TẮT).');
  console.log('Cách đính kèm: Gõ tên file hoặc folder bắt đầu bằng ký tự @ trong câu chat.');
  console.log('Gợi ý tự động (Autocomplete Dropdown): Gõ ký tự @, dùng TAB hoặc phím Lên/Xuống để chọn.');
  console.log('Ví dụ: "Hãy phân tích mã nguồn trong folder @src và file @package.json"\n');

  const onChunk = (chunkText) => {
    parseSSEChunk(chunkText);
  };

  const onDone = () => {
    isWaitingResponse = false;
    process.stdout.write('\n');
    
    if (resolveDonePromise) {
      resolveDonePromise();
      resolveDonePromise = null;
      return;
    }

    // Vẽ lại giao diện prompt sẵn sàng cho câu hỏi tiếp theo
    renderUI();
  };

  const onError = (errMsg) => {
    console.error(`\n[Lỗi Stream]: ${errMsg}`);
    isWaitingResponse = false;
    process.stdout.write('\n');
    
    if (resolveDonePromise) {
      resolveDonePromise();
      resolveDonePromise = null;
      return;
    }

    renderUI();
  };

  try {
    await driver.initBrowser(onChunk, onDone, onError);
    
    // Khởi động lắng nghe bàn phím và hiển thị dòng prompt ban đầu
    setupTerminalInput();
    renderUI();
  } catch (err) {
    console.error(`\n[Lỗi khởi động]: ${err.message}`);
    await driver.closeBrowser();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await driver.closeBrowser();
  process.exit(1);
});
