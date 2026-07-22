#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

const driver = require('./driver');
const fileUtils = require('./utils/file');
const sseUtils = require('./utils/sse');
const markdownUtils = require('./utils/markdown');
const exportImportService = require('./services/exportImport');
const screen = require('./tui/screen');
const editor = require('./tui/editor');

let sseState = {
  currentResponseText: '',
  hasShownThinkingLabel: false,
  hasShownAnswerLabel: false,
  aiResponseStartIndex: -1,
  webSearchInfo: [],
  printedThoughts: []
};

let currentHistoryPage = 1;
let currentHistoryItems = [];
let chatHistory = [];

function rebuildScrollBuffer() {
  const cols = process.stdout.columns || 80;
  let formattedHistory = '';
  
  chatHistory.forEach((msg) => {
    if (msg.role === 'user') {
      const userBlock = editor.formatUserPromptBlock(msg.content, cols);
      formattedHistory += '\n' + userBlock + '\n';
    } else if (msg.role === 'assistant') {
      const parsedCitations = markdownUtils.replaceCitations(msg.content, msg.docs);
      const renderedMarkdown = markdownUtils.renderMarkdown(parsedCitations, cols);
      formattedHistory += `\n\x1b[1m\x1b[38;5;147m🤖 Qwen:\x1b[0m\n${renderedMarkdown}\n`;
    }
  });

  if (editor.isWaitingResponse()) {
    if (sseState.hasShownAnswerLabel || sseState.currentResponseText) {
      formattedHistory += `\n\x1b[1m\x1b[38;5;147m🤖 Qwen:\x1b[0m\n${sseState.currentResponseText}\n`;
    } else if (sseState.hasShownThinkingLabel) {
      formattedHistory += '\n\x1b[38;5;244m🧠 Đang suy nghĩ...\x1b[0m\n';
    }
  }

  screen.setScrollContentBuffer(formattedHistory);
  screen.refreshScrollRegion();
}

let resolveDonePromise = null;
let streamBuffer = '';
let browserInitPromise = null;
let isBrowserReady = false;

let isSilentBatchPrompt = false;

function waitForResponse() {
  return new Promise((resolve) => {
    resolveDonePromise = resolve;
  });
}

async function triggerAutoExport() {
  const chatId = driver.getCurrentChatId();
  if (!chatId) return;
  await exportImportService.exportCurrentChat(chatId);
}

function runAppUpdate() {
  screen.shutdownTUI();
  console.log('===========================================');
  console.log('       CẬP NHẬT QWEN CHAT CLI TOÀN CỤC     ');
  console.log('===========================================');
  console.log('Đang tải và thực thi kịch bản cập nhật mới nhất từ GitHub...');
  const { spawnSync } = require('child_process');
  const isWindows = process.platform === 'win32';
  const timestamp = Date.now();
  
  if (isWindows) {
    spawnSync('powershell', ['-Command', `iwr -useb 'https://raw.githubusercontent.com/SonNX24042005/qwen-cli/main/install.ps1?v=${timestamp}' | iex`], { stdio: 'inherit' });
  } else {
    spawnSync('bash', ['-c', `curl -fsSL "https://raw.githubusercontent.com/SonNX24042005/qwen-cli/main/install.sh?v=${timestamp}" | bash`], { stdio: 'inherit' });
  }
  process.exit(0);
}

function copyLastAssistantMessage() {
  const lastAssistantMsg = [...chatHistory].reverse().find(m => m.role === 'assistant');
  if (!lastAssistantMsg || !lastAssistantMsg.content) {
    screen.consoleLog('[Hệ thống] Không có câu trả lời nào từ Assistant để sao chép.');
    return;
  }

  const textToCopy = lastAssistantMsg.content;

  // 1. In chuỗi mã hóa OSC 52 tới Terminal cho các terminal hỗ trợ
  const base64Text = Buffer.from(textToCopy).toString('base64');
  process.stdout.write(`\x1b]52;c;${base64Text}\x07`);

  // 2. Thử sao chép qua công cụ hệ thống nếu có
  const { exec } = require('child_process');
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  try {
    if (isWindows) {
      const proc = exec('clip');
      proc.stdin.write(textToCopy);
      proc.stdin.end();
    } else if (isMac) {
      const proc = exec('pbcopy');
      proc.stdin.write(textToCopy);
      proc.stdin.end();
    } else {
      exec('which xclip', (err) => {
        if (!err) {
          const proc = exec('xclip -selection clipboard');
          proc.stdin.write(textToCopy);
          proc.stdin.end();
        } else {
          exec('which xsel', (err2) => {
            if (!err2) {
              const proc = exec('xsel --clipboard --input');
              proc.stdin.write(textToCopy);
              proc.stdin.end();
            }
          });
        }
      });
    }
  } catch (e) {}

  screen.consoleLog('[Hệ thống] Đã sao chép phản hồi mới nhất của AI vào Clipboard!');
}

async function handleImportChat(filePath) {
  const parsedMessages = await exportImportService.loadImportedChatData(filePath, (msg) => screen.consoleLog(msg));

  chatHistory = parsedMessages;
  rebuildScrollBuffer();
  screen.setScrollOffset(0);

  const basicHistory = parsedMessages.map(m => ({ role: m.role, content: m.content }));
  await driver.importChatHistory(basicHistory);
  
  screen.consoleLog(`[Hệ thống] Nhập lịch sử trò chuyện thành công! Đã khôi phục ${parsedMessages.length} tin nhắn.`);
}

let authPromptState = null; // null | { step: 'account' } | { step: 'password', account: string }

function cancelAuthPrompt() {
  if (authPromptState) {
    authPromptState = null;
    screen.consoleLog('[Hệ thống] Đã hủy nhập thông tin tài khoản/mật khẩu.');
    editor.renderUI();
  }
}

// Xử lý gửi tin nhắn chính thức của người dùng
async function handleUserMessage(inputText) {
  const trimmedInput = inputText.trim();

  // Nếu đang trong tiến trình nhập từng bước tài khoản/mật khẩu
  if (authPromptState) {
    if (authPromptState.step === 'account') {
      const account = trimmedInput;
      if (!account) {
        screen.consoleLog('[Hệ thống] Đã hủy thiết lập tài khoản.');
        authPromptState = null;
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
      authPromptState = { step: 'password', account };
      screen.consoleLog(`[Hệ thống] 🔒 Bước 2/2: Vui lòng nhập Mật khẩu cho tài khoản (${account}):`);
      editor.setIsWaitingResponse(false);
      editor.renderUI();
      return;
    } else if (authPromptState.step === 'password') {
      const password = trimmedInput;
      const account = authPromptState.account;
      authPromptState = null;
      if (!password) {
        screen.consoleLog('[Hệ thống] Đã hủy thiết lập mật khẩu.');
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
      driver.saveCredentials(account, password);
      screen.consoleLog(`[Hệ thống] ✅ Đã lưu thành công tài khoản (${account})! Lần sau khi token hết hạn, ứng dụng sẽ tự động đăng nhập ngầm.`);
      editor.setIsWaitingResponse(false);
      editor.renderUI();
      return;
    }
  }

  if (!trimmedInput) {
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // Xử lý lệnh thoát
  if (trimmedInput === '/exit') {
    screen.consoleLog('[Hệ thống] Đang thoát chương trình...');
    await screen.shutdownTUI();
    return;
  }

  // Xử lý lệnh sao chép phản hồi mới nhất
  if (trimmedInput === '/copy' || trimmedInput === '/c') {
    copyLastAssistantMessage();
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // Xử lý lệnh xóa màn hình TUI
  if (trimmedInput === '/clear') {
    screen.setScrollContentBuffer('');
    screen.setScrollOffset(0);
    screen.refreshScrollRegion();
    screen.consoleLog('[Hệ thống] Đã xóa toàn bộ màn hình hiển thị TUI (Lịch sử hội thoại vẫn được lưu giữ).');
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // Xử lý lệnh bật/tắt tự động xuất cuộc trò chuyện
  if (trimmedInput === '/export' || trimmedInput === '/ep') {
    const isNowEnabled = driver.toggleExportMode();
    screen.consoleLog(`[Hệ thống] Chế độ tự động xuất đoạn chat sang Markdown/JSON đã được: ${isNowEnabled ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
    if (isNowEnabled) {
      const chatId = driver.getCurrentChatId();
      if (chatId) {
        screen.consoleLog(`[Hệ thống] Phát hiện cuộc hội thoại đang mở, đang tiến hành xuất lịch sử hiện tại...`);
        exportImportService.exportCurrentChat(chatId).then(() => {
          screen.consoleLog(`[Hệ thống] Xuất lịch sử hiện tại thành công!`);
        }).catch((err) => {
          screen.consoleError(`\n[Lỗi xuất cuộc trò chuyện]: ${err.message}`);
        });
      }
    }
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // Xử lý lệnh nhập lịch sử cuộc trò chuyện từ file
  if (trimmedInput.startsWith('/import') || trimmedInput.startsWith('/ip')) {
    const parts = trimmedInput.split(/\s+/);
    const cmd = parts[0];
    if (cmd === '/import' || cmd === '/ip') {
      const filePath = trimmedInput.substring(cmd.length).trim();
      if (!filePath) {
        screen.consoleError(`[Lỗi] Vui lòng cung cấp đường dẫn đến file JSON hoặc Markdown cần nhập.`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
      screen.consoleLog(`\n[Hệ thống] Đang tải lịch sử trò chuyện từ file: ${filePath}...`);
      editor.setIsWaitingResponse(true);
      try {
        await handleImportChat(filePath);
      } catch (err) {
        screen.consoleError(`[Lỗi nhập cuộc trò chuyện]: ${err.message}`);
      } finally {
        editor.setIsWaitingResponse(false);
        editor.renderUI();
      }
      return;
    }
  }

  // Xử lý lệnh lưu/xem tài khoản & mật khẩu tự động đăng nhập
  if (trimmedInput.startsWith('/auth') || trimmedInput.startsWith('/login')) {
    const parts = trimmedInput.split(/\s+/);
    const cmd = parts[0];
    if (cmd === '/auth' || cmd === '/login') {
      const account = parts[1];
      const password = parts[2];
      
      if (account && password) {
        driver.saveCredentials(account, password);
        screen.consoleLog(`[Hệ thống] ✅ Đã lưu thành công tài khoản (${account})! Lần sau khi token hết hạn, ứng dụng sẽ tự động đăng nhập ngầm.`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }

      // Kích hoạt tiến trình nhập từng bước tương tác
      const currentCreds = driver.getSavedCredentials();
      if (currentCreds) {
        screen.consoleLog(`[Hệ thống] Tài khoản đang lưu hiện tại: ${currentCreds.account}`);
      }
      authPromptState = { step: 'account' };
      screen.consoleLog(`[Hệ thống] 🔑 Bước 1/2: Vui lòng nhập Tài khoản/Email/SĐT của bạn (Nhấn Enter để hủy):`);
      editor.setIsWaitingResponse(false);
      editor.renderUI();
      return;
    }
  }

  // Xử lý lệnh tự động cập nhật phần mềm từ trong phiên chat
  if (trimmedInput === '/update' || trimmedInput === '/up') {
    runAppUpdate();
    return;
  }

  // Xử lý lệnh thay đổi chế độ suy nghĩ có hoặc không có tham số
  if (trimmedInput.startsWith('/mode') || trimmedInput.startsWith('/md')) {
    const parts = trimmedInput.split(/\s+/);
    const cmd = parts[0];
    if (cmd === '/mode' || cmd === '/md') {
      const modeArg = parts[1] ? parts[1].toLowerCase().trim() : '';
      if (['fast', 'thinking', 'auto'].includes(modeArg)) {
        await driver.setThinkingMode(modeArg);
        const modeDisplay = modeArg === 'fast' ? 'Fast' : (modeArg === 'thinking' ? 'Thinking' : 'Auto');
        screen.consoleLog(`[Hệ thống] Chế độ suy nghĩ đã được chuyển thành: ${modeDisplay}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      } else if (modeArg === '') {
        const currentMode = driver.getThinkingMode();
        const currentModeDisplay = currentMode === 'fast' ? 'Fast' : (currentMode === 'thinking' ? 'Thinking' : 'Auto');
        screen.consoleLog(`[Hệ thống] Chế độ suy nghĩ hiện tại: ${currentModeDisplay}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      } else {
        screen.consoleError(`[Lỗi] Chế độ không hợp lệ. Các chế độ hỗ trợ: fast, thinking, auto`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
    }
  }

  // Xử lý lệnh bật/tắt hiển thị suy nghĩ chi tiết
  if (trimmedInput === '/detail' || trimmedInput === '/dt') {
    const currentStatus = driver.isDetailedThinking();
    const newStatus = !currentStatus;
    driver.setDetailedThinking(newStatus);
    screen.consoleLog(`[Hệ thống] Hiển thị suy nghĩ chi tiết đã được: ${newStatus ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // Xử lý lệnh xem lịch sử cuộc trò chuyện
  if (trimmedInput === '/resume' || trimmedInput === '/rs') {
    screen.consoleLog(`\n[Hệ thống] Đang tải danh sách lịch sử cuộc trò chuyện...`);
    editor.setIsWaitingResponse(true);
    
    try {
      currentHistoryPage = 1;
      const history = await driver.getChatHistory(1);
      if (!history || history.length === 0) {
        screen.consoleLog('[Hệ thống] Không tìm thấy cuộc trò chuyện nào trong lịch sử.');
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
      
      currentHistoryItems = history;
      const hasMore = history.length >= 10;
      editor.showHistorySelection(history, hasMore);
    } catch (err) {
      screen.consoleError(`[Lỗi tải lịch sử]: ${err.message}`);
      editor.setIsWaitingResponse(false);
      editor.renderUI();
    }
    return;
  }

  // Xử lý lệnh tạo cuộc trò chuyện mới
  if (trimmedInput === '/new') {
    screen.consoleLog(`\n[Hệ thống] Đang tạo cuộc trò chuyện mới...`);
    editor.setIsWaitingResponse(true);
    
    try {
      await driver.newChat();
      chatHistory = [];
      rebuildScrollBuffer();
      screen.setScrollOffset(0);
      screen.consoleLog(`[Hệ thống] Đã tạo cuộc trò chuyện mới thành công!`);
    } catch (err) {
      screen.consoleError(`[Lỗi tạo cuộc trò chuyện mới]: ${err.message}`);
    } finally {
      editor.setIsWaitingResponse(false);
      editor.renderUI();
    }
    return;
  }

  let finalPrompt = trimmedInput;

  // Xử lý lệnh bật/tắt Web Search kèm hoặc không kèm prompt
  if (trimmedInput.startsWith('/websearch') || trimmedInput.startsWith('/wedsearch') || trimmedInput.startsWith('/ws')) {
    let isExactMatch = false;
    let startsWithSpace = false;
    let cmdLength = 0;

    if (trimmedInput === '/websearch' || trimmedInput === '/wedsearch') {
      isExactMatch = true;
    } else if (trimmedInput.startsWith('/websearch ') || trimmedInput.startsWith('/wedsearch ')) {
      startsWithSpace = true;
      cmdLength = trimmedInput.startsWith('/websearch ') ? '/websearch '.length : '/wedsearch '.length;
    } else if (trimmedInput === '/ws') {
      isExactMatch = true;
    } else if (trimmedInput.startsWith('/ws ')) {
      startsWithSpace = true;
      cmdLength = '/ws '.length;
    }

    if (isExactMatch) {
      const currentStatus = driver.getWebSearch();
      const newStatus = !currentStatus;
      await driver.setWebSearch(newStatus);
      screen.consoleLog(`[Hệ thống] Tìm kiếm Web đã được: ${newStatus ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
      editor.setIsWaitingResponse(false);
      editor.renderUI();
      return;
    } else if (startsWithSpace) {
      const extractedPrompt = trimmedInput.slice(cmdLength).trim();
      if (!extractedPrompt) {
        const currentStatus = driver.getWebSearch();
        const newStatus = !currentStatus;
        await driver.setWebSearch(newStatus);
        screen.consoleLog(`[Hệ thống] Tìm kiếm Web đã được: ${newStatus ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      } else {
        await driver.setWebSearch(true);
        screen.consoleLog(`[Hệ thống] Đã tự động BẬT (ON) Tìm kiếm Web và ghi nhớ cấu hình này.`);
        finalPrompt = extractedPrompt;
      }
    }
  }

  // Nếu trình duyệt chưa khởi động xong, chờ khởi động hoàn tất
  if (!isBrowserReady && browserInitPromise) {
    screen.consoleLog('[Hệ thống] Trình duyệt đang khởi động, yêu cầu của bạn sẽ được gửi ngay sau khi kết nối sẵn sàng...');
    await browserInitPromise;
  }

  // 1. Phân tích các tệp đính kèm @path
  const pathsToProcess = fileUtils.extractAttachedFiles(finalPrompt);
  let allFilesToUpload = [];

  if (pathsToProcess.length > 0) {
    screen.consoleLog(`[Hệ thống] Đang phân tích ${pathsToProcess.length} đường dẫn đính kèm...`);
    
    for (const pathItem of pathsToProcess) {
      const resolvedPath = path.isAbsolute(pathItem) ? path.resolve(pathItem) : path.resolve(process.cwd(), pathItem);
      
      if (!fs.existsSync(resolvedPath)) {
        screen.consoleError(`[Lỗi]: Đường dẫn @${pathItem} không tồn tại: ${resolvedPath}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }

      const relativePath = path.relative(process.cwd(), resolvedPath);
      const stat = fs.statSync(resolvedPath);
      
      if (stat.isDirectory()) {
        screen.consoleLog(`[Hệ thống] Đang quét thư mục: @${pathItem}...`);
        const folderFiles = fileUtils.getFilesRecursively(resolvedPath);
        screen.consoleLog(`[Hệ thống] Quét xong. Tìm thấy ${folderFiles.length} file hợp lệ trong thư mục.`);
        allFilesToUpload = allFilesToUpload.concat(folderFiles);

        const safeNames = folderFiles.map(f => {
          const relF = path.relative(process.cwd(), f);
          return relF.split(path.sep).join('--').replace(/[^a-zA-Z0-9_.-]/g, '_');
        });
        
        const replacement = `@${pathItem} (thư mục chứa các tệp đã tải lên: ${safeNames.join(', ')})`;
        finalPrompt = finalPrompt.replace(new RegExp(`@${pathItem}/?`, 'g'), replacement);
      } else {
        allFilesToUpload.push(resolvedPath);

        const safeRelativeName = relativePath
          .split(path.sep)
          .join('--')
          .replace(/[^a-zA-Z0-9_.-]/g, '_');

        const replacement = `@${pathItem} (được tải lên với tên: ${safeRelativeName})`;
        finalPrompt = finalPrompt.replace(new RegExp(`@${pathItem}`, 'g'), replacement);
      }
    }
    
    allFilesToUpload = [...new Set(allFilesToUpload)];
    screen.consoleLog(`[Hệ thống] Tổng số file đính kèm cần gửi lên: ${allFilesToUpload.length} file.`);
  }

  // 2. Chia nhóm upload dần dần nếu nhiều hơn 5 file
  if (allFilesToUpload.length > 5) {
    screen.consoleLog(`[Hệ thống] Do Qwen giới hạn 5 file/lượt, hệ thống sẽ tự động chia thành các nhóm để tải lên dần dần...`);
    
    const fileChunks = fileUtils.chunkArray(allFilesToUpload, 5);
    const totalChunks = fileChunks.length;

    for (let i = 0; i < totalChunks - 1; i++) {
      const currentChunk = fileChunks[i];
      const chunkIndex = i + 1;
      
      screen.consoleLog(`\n[Hệ thống] Đang chuẩn bị nhóm file ${chunkIndex}/${totalChunks} (Gồm ${currentChunk.length} file)...`);
      
      for (const filePath of currentChunk) {
        try {
          await driver.uploadFile(filePath);
        } catch (err) {
          screen.consoleError(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
          editor.setIsWaitingResponse(false);
          editor.renderUI();
          return;
        }
      }

      sseState.currentResponseText = '';
      sseState.hasShownThinkingLabel = false;
      sseState.hasShownAnswerLabel = false;
      sseState.aiResponseStartIndex = -1;
      sseState.webSearchInfo = [];
      sseState.printedThoughts = [];
      streamBuffer = '';

      const silentPrompt = `[Hệ thống] Đây là nhóm tệp đính kèm thứ ${chunkIndex} trên tổng số ${totalChunks}. Vui lòng ghi nhớ và phân tích nội dung các tệp này để chuẩn bị trả lời câu hỏi tiếp theo.`;
      screen.consoleLog(`[Hệ thống] Gửi thông tin nhóm ${chunkIndex}/${totalChunks} lên Qwen...`);
      
      try {
        isSilentBatchPrompt = true;
        await driver.sendPrompt(silentPrompt);
        await waitForResponse();
      } catch (err) {
        screen.consoleError(`\n[Lỗi gửi nhóm file]: ${err.message}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      } finally {
        isSilentBatchPrompt = false;
      }
    }

    const lastChunk = fileChunks[totalChunks - 1];
    screen.consoleLog(`\n[Hệ thống] Đang tải lên nhóm file cuối cùng ${totalChunks}/${totalChunks} (Gồm ${lastChunk.length} file)...`);
    
    for (const filePath of lastChunk) {
      try {
        await driver.uploadFile(filePath);
      } catch (err) {
        screen.consoleError(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
    }
  } else if (allFilesToUpload.length > 0) {
    for (const filePath of allFilesToUpload) {
      try {
        await driver.uploadFile(filePath);
      } catch (err) {
        screen.consoleError(`[Lỗi Upload File ${path.basename(filePath)}]: ${err.message}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
    }
  }

  // 3. Gửi prompt chính thức
  sseState.currentResponseText = '';
  sseState.hasShownThinkingLabel = false;
  sseState.hasShownAnswerLabel = false;
  sseState.aiResponseStartIndex = -1;
  sseState.webSearchInfo = [];
  sseState.printedThoughts = [];
  streamBuffer = '';

  const searchStatus = driver.getWebSearch() ? 'BẬT' : 'TẮT';
  screen.consoleLog(`\n[Hệ thống] Gửi yêu cầu chính thức (Tìm kiếm Web: ${searchStatus})...`);

  // Lưu câu hỏi vào lịch sử và render lại vùng cuộn
  chatHistory.push({ role: 'user', content: finalPrompt });
  rebuildScrollBuffer();

  try {
    await driver.sendPrompt(finalPrompt);
  } catch (err) {
    screen.consoleError(`\n[Lỗi gửi tin nhắn]: ${err.message}`);
    editor.setIsWaitingResponse(false);
    editor.renderUI();
  }
}

async function main() {
  // Kiểm tra đối số cập nhật phần mềm tự động
  if (process.argv.includes('--update') || process.argv.includes('-u') || process.argv.includes('update')) {
    runAppUpdate();
    return;
  }

  // 0. Phân tích đối số dòng lệnh để thiết lập chế độ suy nghĩ ban đầu
  let initialThinkingMode = 'auto';
  const modeArgIndex = process.argv.findIndex(arg => arg === '--mode' || arg === '--think' || arg === '-t');
  if (modeArgIndex !== -1 && process.argv[modeArgIndex + 1]) {
    const val = process.argv[modeArgIndex + 1].toLowerCase().trim();
    if (['fast', 'thinking', 'auto'].includes(val)) {
      initialThinkingMode = val;
    }
  }
  process.argv.forEach(arg => {
    if (arg.startsWith('--mode=')) {
      const val = arg.split('=')[1].toLowerCase().trim();
      if (['fast', 'thinking', 'auto'].includes(val)) {
        initialThinkingMode = val;
      }
    } else if (arg.startsWith('--think=')) {
      const val = arg.split('=')[1].toLowerCase().trim();
      if (['fast', 'thinking', 'auto'].includes(val)) {
        initialThinkingMode = val;
      }
    }
  });

  await driver.setThinkingMode(initialThinkingMode);

  // 1. Khởi chạy Alternate Screen Buffer và Scrolling Region sạch sẽ đầu tiên
  screen.initTUI();
  screen.setRenderUICallback(editor.renderUI);

  screen.consoleLog('=== QWEN CHAT CLI ===');
  screen.consoleLog('Nhập "/exit" hoặc nhấn Ctrl+C để thoát chương trình.');
  screen.consoleLog('Nhập "/copy" hoặc "/c" để sao chép phản hồi mới nhất của AI vào Clipboard.');
  screen.consoleLog('Nhập "/clear" để xóa sạch màn hình hiển thị TUI.');
  screen.consoleLog('Nhập "/websearch" hoặc "/ws" để bật/tắt Tìm kiếm Web (Mặc định: TẮT).');
  screen.consoleLog('Nhập "/export" hoặc "/ep" để bật/tắt Tự động xuất chat sang Markdown/JSON (Mặc định: TẮT).');
  screen.consoleLog('Nhập "/import <path>" hoặc "/ip <path>" để khôi phục lịch sử trò chuyện.');
  screen.consoleLog('Cách đính kèm: Gõ tên file hoặc folder bắt đầu bằng ký tự @ trong câu chat.');
  screen.consoleLog('Gợi ý tự động (Autocomplete Dropdown): Gõ ký tự @, dùng TAB hoặc phím Lên/Xuống để chọn.');
  screen.consoleLog('Kéo thả file: Bạn có thể kéo thả trực tiếp file/folder từ File Explorer vào đây để đính kèm!\n');

  const onChunk = (chunkText) => {
    // Chuẩn hóa ngắt dòng CRLF (\r\n) thành LF (\n) để xử lý stream đồng nhất
    streamBuffer += chunkText.replace(/\r\n/g, '\n');
    
    let boundaryIdx;
    while ((boundaryIdx = streamBuffer.indexOf('\n\ndata:')) !== -1) {
      const eventText = streamBuffer.slice(0, boundaryIdx).trim();
      streamBuffer = streamBuffer.slice(boundaryIdx + 2); // slice past newlines, keep 'data:'
      
      if (eventText) {
        sseState = sseUtils.parseSSEChunk(eventText, sseState, (t) => {
          screen.printInScrollRegion(t);
        });
      }
    }
  };

  const onDone = () => {
    editor.setIsWaitingResponse(false);
    screen.stopThinkingSpinner();
    
    // Xử lý nốt phần buffer còn lại nếu có
    if (streamBuffer.trim()) {
      sseState = sseUtils.parseSSEChunk(streamBuffer.trim(), sseState, (t) => {
        screen.printInScrollRegion(t);
      });
      streamBuffer = '';
    }
    
    // Lưu câu trả lời của AI vào lịch sử và render lại sạch sẽ vùng cuộn
    if (sseState.currentResponseText && !isSilentBatchPrompt) {
      chatHistory.push({ role: 'assistant', content: sseState.currentResponseText, docs: sseState.webSearchInfo });
    }
    rebuildScrollBuffer();

    driver.checkAndSyncNewChatExport();
    if (driver.isExportModeEnabled()) {
      triggerAutoExport().catch((err) => {
        screen.consoleError(`\n[Lỗi xuất cuộc trò chuyện]: ${err.message}`);
      });
    }
    
    if (resolveDonePromise) {
      resolveDonePromise();
      resolveDonePromise = null;
      return;
    }

    editor.renderUI();
  };

  const onError = (errMsg) => {
    editor.setIsWaitingResponse(false);
    screen.stopThinkingSpinner();
    
    // Xử lý nốt phần buffer còn lại nếu có
    if (streamBuffer.trim()) {
      sseState = sseUtils.parseSSEChunk(streamBuffer.trim(), sseState, (t) => {
        screen.printInScrollRegion(t);
      });
      streamBuffer = '';
    }
    
    // Lưu câu trả lời dở dang vào lịch sử nếu có
    if (sseState.currentResponseText) {
      chatHistory.push({ role: 'assistant', content: sseState.currentResponseText, docs: sseState.webSearchInfo });
    }
    rebuildScrollBuffer();

    driver.checkAndSyncNewChatExport();
    if (driver.isExportModeEnabled()) {
      triggerAutoExport().catch((err) => {
        screen.consoleError(`\n[Lỗi xuất cuộc trò chuyện]: ${err.message}`);
      });
    }
    
    screen.consoleError(`\n[Lỗi Stream]: ${errMsg}`);
    
    if (resolveDonePromise) {
      resolveDonePromise();
      resolveDonePromise = null;
      return;
    }

    editor.renderUI();
  };

  const onResumeChat = async (chatId) => {
    editor.setIsWaitingResponse(true);
    
    if (chatId === 'load_more') {
      screen.consoleLog(`\n[Hệ thống] Đang tải thêm danh sách cuộc trò chuyện...`);
      try {
        currentHistoryPage += 1;
        const newItems = await driver.getChatHistory(currentHistoryPage);
        if (!newItems || newItems.length === 0) {
          screen.consoleLog('[Hệ thống] Không còn cuộc trò chuyện nào cũ hơn.');
          editor.showHistorySelection(currentHistoryItems, false);
          return;
        }
        
        currentHistoryItems = currentHistoryItems.concat(newItems);
        const hasMore = newItems.length >= 10;
        editor.showHistorySelection(currentHistoryItems, hasMore);
      } catch (err) {
        screen.consoleError(`[Lỗi tải thêm lịch sử]: ${err.message}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
      }
      return;
    }
    
    screen.consoleLog(`\n[Hệ thống] Đang tải chi tiết cuộc trò chuyện và đồng bộ hóa trình duyệt...`);
    
    try {
      const chatData = await driver.getChatDetails(chatId);
      if (!chatData) {
        screen.consoleLog('[Lỗi] Không thể tải chi tiết cuộc trò chuyện.');
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
      }
      
      chatHistory = [];
      const msgMap = chatData.chat && chatData.chat.messages ? chatData.chat.messages : {};
      const messages = Object.values(msgMap).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      messages.forEach(msg => {
        if (msg.role === 'user') {
          chatHistory.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          let assistantContent = msg.content || '';
          if (msg.content_list && msg.content_list.length > 0) {
            const answerItem = msg.content_list.find(item => item.phase === 'answer');
            if (answerItem) {
              assistantContent = answerItem.content || '';
            } else {
              const lastItem = msg.content_list[msg.content_list.length - 1];
              assistantContent = lastItem.content || '';
            }
          }
          
          let lastDocs = null;
          if (msg.content_list && Array.isArray(msg.content_list)) {
            for (let i = msg.content_list.length - 1; i >= 0; i--) {
              const item = msg.content_list[i];
              if (item.phase === 'web_search' && item.extra) {
                const docs = item.extra.web_search_info || (item.extra.tool_result && item.extra.tool_result.docs);
                if (docs && Array.isArray(docs) && docs.length > 0) {
                  lastDocs = docs;
                  break;
                }
              }
            }
          }
          
          chatHistory.push({ role: 'assistant', content: assistantContent, docs: lastDocs });
        }
      });
      
      rebuildScrollBuffer();
      screen.setScrollOffset(0);
      
      await driver.resumeChat(chatId);
      screen.consoleLog(`[Hệ thống] Phục hồi cuộc trò chuyện thành công!`);
    } catch (err) {
      screen.consoleError(`[Lỗi phục hồi cuộc trò chuyện]: ${err.message}`);
    } finally {
      editor.setIsWaitingResponse(false);
      editor.renderUI();
    }
  };

  // 2. Khởi chạy trình duyệt và kết nối trong background (tự ghi nhận kết quả và cập nhật isBrowserReady)
  browserInitPromise = driver.initBrowser(onChunk, onDone, onError)
    .then(async () => {
      isBrowserReady = true;

      // Lấy danh sách model thật từ server và cập nhật dropdown
      try {
        const fetchedModels = await driver.getModelsFromWeb();
        if (fetchedModels && fetchedModels.length > 0) {
          editor.setModelOptions(fetchedModels);
          editor.renderUI(); // Vẽ lại TUI để áp dụng danh sách model mới
          screen.consoleLog(`[Hệ thống] Đã tải ${fetchedModels.length} mô hình từ Qwen.`);
        }
      } catch (_) {
        // Bỏ qua lỗi - danh sách dự phòng đã được dùng
      }
    })
    .catch(async (err) => {
      screen.consoleError(`\n[Lỗi khởi động]: ${err.message}`);
      await screen.shutdownTUI();
    });

  // 3. Khởi tạo lắng nghe bàn phím và vẽ UI ngay lập tức để người dùng có thể nhập liệu/chọn tính năng
  try {
    screen.setResizeCallback(rebuildScrollBuffer);
    editor.setupTerminalInput(handleUserMessage, onResumeChat, cancelAuthPrompt);
    editor.renderUI();
  } catch (err) {
    screen.consoleError(`\n[Lỗi hiển thị TUI]: ${err.message}`);
    await screen.shutdownTUI();
  }
}

// Lưới bảo vệ cuối cùng: các callback bất đồng bộ rời rạc
process.on('unhandledRejection', async (err) => {
  screen.consoleError(`\n[Lỗi không mong muốn]: ${err && err.message ? err.message : err}`);
  await screen.shutdownTUI();
});

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await screen.shutdownTUI();
});
