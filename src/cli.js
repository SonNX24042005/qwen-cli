'use strict';

const path = require('path');
const fs = require('fs');
const { Marked } = require('marked');
const { markedTerminal } = require('marked-terminal');

const driver = require('./driver');
const fileUtils = require('./utils/file');
const sseUtils = require('./utils/sse');
const screen = require('./tui/screen');
const editor = require('./tui/editor');

const chalkInstance = require('chalk').default || require('chalk');

const extension = markedTerminal({
  showSectionPrefix: false, // Tắt hiển thị ký tự # trước tiêu đề
  firstHeading: chalkInstance.white.bold.underline,
  heading: chalkInstance.white.bold,
  code: chalkInstance.hex('#c9d1d9'),
  codespan: chalkInstance.cyan,
  link: chalkInstance.hex('#58a6ff'),
  href: chalkInstance.hex('#58a6ff').underline,
  blockquote: chalkInstance.gray.italic,
  tableOptions: {
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├',
      'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤',
      'middle': '│'
    },
    style: {
      head: ['white', 'bold'],
      border: ['gray']
    }
  }
});

// Sửa lỗi marked v15 không bôi đậm được văn bản nằm trong thẻ text
const originalText = extension.renderer.text;
extension.renderer.text = function(token) {
  if (token && typeof token === 'object' && token.tokens) {
    return this.parser.parseInline(token.tokens);
  }
  return originalText.call(this, token);
};

const marked = new Marked(extension);

let sseState = {
  currentResponseText: '',
  hasShownThinkingLabel: false,
  hasShownAnswerLabel: false,
  aiResponseStartIndex: -1,
  webSearchInfo: []
};

// Thay thế các ký hiệu [[N]] thành liên kết Markdown [[N] domain](url)
function replaceCitations(text, docs) {
  return text.replace(/\[\[(\d+)\]\]/g, (match, numStr) => {
    const idx = parseInt(numStr, 10) - 1;
    if (docs && Array.isArray(docs) && docs[idx]) {
      const doc = docs[idx];
      let domain = '';
      try {
        domain = new URL(doc.url).hostname;
      } catch (e) {
        const m = doc.url.match(/https?:\/\/([^\/]+)/);
        domain = m ? m[1] : 'link';
      }
      if (domain.startsWith('www.')) domain = domain.slice(4);
      
      return `[[${numStr}] ${domain}](${doc.url})`;
    }
    // Nếu không có tài liệu cụ thể tương ứng, chuẩn hóa thành [N] cho giống chú thích GitHub
    return `[${numStr}]`;
  });
}

// Biến Promise dùng để đồng bộ hóa hàng đợi gửi tin nhắn
let resolveDonePromise = null;
let streamBuffer = '';

function waitForResponse() {
  return new Promise((resolve) => {
    resolveDonePromise = resolve;
  });
}

// Xử lý gửi tin nhắn chính thức của người dùng
async function handleUserMessage(inputText) {
  const trimmedInput = inputText.trim();
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

  // Xử lý lệnh bật/tắt Web Search
  if (trimmedInput === '/websearch' || trimmedInput === '/ws') {
    const currentStatus = driver.getWebSearch();
    const newStatus = !currentStatus;
    await driver.setWebSearch(newStatus);
    screen.consoleLog(`[Hệ thống] Tìm kiếm Web đã được: ${newStatus ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
    editor.setIsWaitingResponse(false);
    editor.renderUI();
    return;
  }

  // 1. Phân tích các tệp đính kèm @path
  const pathsToProcess = fileUtils.extractAttachedFiles(trimmedInput);
  let allFilesToUpload = [];
  let finalPrompt = trimmedInput;

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
      streamBuffer = '';

      const silentPrompt = `[Hệ thống] Đây là nhóm tệp đính kèm thứ ${chunkIndex} trên tổng số ${totalChunks}. Vui lòng ghi nhớ và phân tích nội dung các tệp này để chuẩn bị trả lời câu hỏi tiếp theo.`;
      screen.consoleLog(`[Hệ thống] Gửi thông tin nhóm ${chunkIndex}/${totalChunks} lên Qwen...`);
      
      try {
        await driver.sendPrompt(silentPrompt);
        await waitForResponse();
      } catch (err) {
        screen.consoleError(`\n[Lỗi gửi nhóm file]: ${err.message}`);
        editor.setIsWaitingResponse(false);
        editor.renderUI();
        return;
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
  streamBuffer = '';

  const searchStatus = driver.getWebSearch() ? 'BẬT' : 'TẮT';
  screen.consoleLog(`\n[Hệ thống] Gửi yêu cầu chính thức (Tìm kiếm Web: ${searchStatus})...`);

  try {
    await driver.sendPrompt(finalPrompt);
  } catch (err) {
    screen.consoleError(`\n[Lỗi gửi tin nhắn]: ${err.message}`);
    editor.setIsWaitingResponse(false);
    editor.renderUI();
  }
}

async function main() {
  // 1. Khởi chạy Alternate Screen Buffer và Scrolling Region sạch sẽ đầu tiên
  screen.initTUI();
  screen.setRenderUICallback(editor.renderUI);

  screen.consoleLog('=== QWEN CHAT CLI ===');
  screen.consoleLog('Nhập "/exit" hoặc nhấn Ctrl+C để thoát chương trình.');
  screen.consoleLog('Nhập "/websearch" hoặc "/ws" để bật/tắt Tìm kiếm Web (Mặc định: TẮT).');
  screen.consoleLog('Cách đính kèm: Gõ tên file hoặc folder bắt đầu bằng ký tự @ trong câu chat.');
  screen.consoleLog('Gợi ý tự động (Autocomplete Dropdown): Gõ ký tự @, dùng TAB hoặc phím Lên/Xuống để chọn.');
  screen.consoleLog('Kéo thả file: Bạn có thể kéo thả trực tiếp file/folder từ File Explorer vào đây để đính kèm!\n');

  const onChunk = (chunkText) => {
    streamBuffer += chunkText;
    
    let boundaryIdx;
    while ((boundaryIdx = streamBuffer.indexOf('\n\ndata:')) !== -1) {
      const eventText = streamBuffer.slice(0, boundaryIdx).trim();
      streamBuffer = streamBuffer.slice(boundaryIdx + 2); // slice past the newlines, keep 'data:'
      
      if (eventText) {
        sseState = sseUtils.parseSSEChunk(eventText, sseState, (t) => {
          screen.printInScrollRegion(t);
        });
      }
    }
  };

  const onDone = () => {
    editor.setIsWaitingResponse(false);
    
    // Xử lý nốt phần buffer còn lại nếu có
    if (streamBuffer.trim()) {
      sseState = sseUtils.parseSSEChunk(streamBuffer.trim(), sseState, (t) => {
        screen.printInScrollRegion(t);
      });
      streamBuffer = '';
    }
    
    // Render Markdown cho câu trả lời của AI và cập nhật vào buffer
    if (sseState.aiResponseStartIndex !== -1) {
      const rawText = sseState.currentResponseText;
      const parsedCitations = replaceCitations(rawText, sseState.webSearchInfo);
      let renderedMarkdown = '';
      try {
        renderedMarkdown = marked.parse(parsedCitations).trimEnd();
      } catch (err) {
        renderedMarkdown = parsedCitations;
      }
      
      const bufferBefore = screen.getScrollContentBuffer().slice(0, sseState.aiResponseStartIndex);
      screen.setScrollContentBuffer(bufferBefore + renderedMarkdown + '\n');
      screen.refreshScrollRegion();
    } else {
      screen.printInScrollRegion('\n');
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
    
    // Xử lý nốt phần buffer còn lại nếu có
    if (streamBuffer.trim()) {
      sseState = sseUtils.parseSSEChunk(streamBuffer.trim(), sseState, (t) => {
        screen.printInScrollRegion(t);
      });
      streamBuffer = '';
    }
    
    // Render Markdown cho phần câu trả lời đã nhận được nếu có
    if (sseState.aiResponseStartIndex !== -1) {
      const rawText = sseState.currentResponseText;
      const parsedCitations = replaceCitations(rawText, sseState.webSearchInfo);
      let renderedMarkdown = '';
      try {
        renderedMarkdown = marked.parse(parsedCitations).trimEnd();
      } catch (err) {
        renderedMarkdown = parsedCitations;
      }
      
      const bufferBefore = screen.getScrollContentBuffer().slice(0, sseState.aiResponseStartIndex);
      screen.setScrollContentBuffer(bufferBefore + renderedMarkdown + '\n');
    }
    
    screen.consoleError(`\n[Lỗi Stream]: ${errMsg}`);
    
    if (resolveDonePromise) {
      resolveDonePromise();
      resolveDonePromise = null;
      return;
    }

    editor.renderUI();
  };

  try {
    // 2. Khởi chạy trình duyệt và kết nối (Tất cả logs in sạch sẽ trong màn hình TUI)
    await driver.initBrowser(onChunk, onDone, onError);
    
    // 3. Khởi tạo lắng nghe bàn phím và vẽ UI
    editor.setupTerminalInput(handleUserMessage);
    editor.renderUI();
  } catch (err) {
    screen.consoleError(`\n[Lỗi khởi động]: ${err.message}`);
    await screen.shutdownTUI();
  }
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await screen.shutdownTUI();
});
