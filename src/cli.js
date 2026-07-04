#!/usr/bin/env node
'use strict';


const path = require('path');
const fs = require('fs');
const { Marked } = require('marked');
const { markedTerminal } = require('marked-terminal');
const Renderer = require('marked-terminal').default || require('marked-terminal');
const supportsHyperlinks = require('supports-hyperlinks');
const ansiEscapes = require('ansi-escapes');

function wrapAnsiText(text, width) {
  const lines = text.split('\n');
  const reflowed = [];
  const ansiRegex = /\u001b\[[0-9;]*m|\u001b\]8;[^;]*;[^\u0007]*\u0007|\u001b\]8;;\u0007/g;
  
  lines.forEach((line) => {
    const cleanLine = line.replace(ansiRegex, '');
    if (cleanLine.length <= width) {
      reflowed.push(line);
      return;
    }
    
    const tokens = line.split(/([ \t]+)/);
    let currentLine = '';
    let currentLength = 0;
    
    for (const token of tokens) {
      if (!token) continue;
      
      const cleanToken = token.replace(ansiRegex, '');
      const cleanLen = cleanToken.length;
      
      if (currentLength + cleanLen > width) {
        if (currentLength === 0) {
          currentLine += token;
          currentLength += cleanLen;
        } else {
          reflowed.push(currentLine.trimEnd());
          const trimmedToken = token.trimStart();
          const trimmedClean = trimmedToken.replace(ansiRegex, '');
          currentLine = trimmedToken;
          currentLength = trimmedClean.length;
        }
      } else {
        currentLine += token;
        currentLength += cleanLen;
      }
    }
    
    if (currentLine) {
      reflowed.push(currentLine.trimEnd());
    }
  });
  
  return reflowed.join('\n');
}

// Theo dõi độ sâu lồng nhau của list để tính toán thụt lề chính xác khi wrap
let listDepth = 0;
const originalList = Renderer.prototype.list;
Renderer.prototype.list = function(body, ordered) {
  listDepth++;
  try {
    return originalList.call(this, body, ordered);
  } finally {
    listDepth--;
  }
};

const BULLET_POINT = '* ';

// Ghi đè Renderer.prototype.listitem để tự động wrap text cho list item theo chiều ngang terminal mà không làm hỏng list lồng nhau
Renderer.prototype.listitem = function(item) {
  if (typeof item !== 'object') {
    return '\n' + BULLET_POINT + item;
  }
  
  let itemText = '';
  let nestedBlocksHtml = '';
  
  if (item.tokens && item.tokens.length > 0) {
    const firstToken = item.tokens[0];
    const otherTokens = item.tokens.slice(1);
    
    // Parse các token inline của paragraph thay vì parse block để tránh bị Renderer.prototype.paragraph wrap trước
    if (firstToken.tokens) {
      itemText = this.parser.parseInline(firstToken.tokens);
    } else {
      itemText = firstToken.text || '';
    }
    
    if (otherTokens.length > 0) {
      nestedBlocksHtml = this.parser.parse(otherTokens);
    }
  } else {
    itemText = item.text || '';
  }
  
  if (item.task) {
    const checkbox = this.checkbox({ checked: !!item.checked });
    itemText = checkbox + itemText;
  }
  
  const width = this.o.width || 80;
  const tabLen = this.tab ? this.tab.length : 4;
  const prefix = '* ';
  const prefixLen = prefix.length;
  
  // Tính toán chính xác độ rộng giới hạn cuộn dựa trên độ sâu listDepth
  const depth = Math.max(1, listDepth);
  const targetWrapWidth = Math.max(30, width - (depth * tabLen) - ((depth - 1) * 2) - prefixLen);
  const wrappedContent = wrapAnsiText(itemText, targetWrapWidth);
  
  const wrappedLines = wrappedContent.split('\n');
  const indentedContent = wrappedLines.map((wl, idx) => {
    if (idx === 0) return wl;
    return ' '.repeat(prefixLen) + wl;
  }).join('\n');
  
  let finalContent = indentedContent;
  if (nestedBlocksHtml) {
    finalContent += '\n' + nestedBlocksHtml.trimEnd();
  }
  
  const transform = (txt) => this.o.listitem(this.transform(txt));
  return '\n' + BULLET_POINT + transform(finalContent);
};

// Ghi đè Renderer.prototype.link để tránh tự động nối tiếp URL thô trong ngoặc đơn nếu terminal không hỗ trợ hyperlink
Renderer.prototype.link = function(href, title, text) {
  if (typeof href === 'object') {
    title = href.title;
    text = this.parser.parseInline(href.tokens);
    href = href.href;
  }
  
  if (supportsHyperlinks.stdout) {
    const linkText = text ? this.o.href(this.emoji(text)) : this.o.href(href);
    return this.o.link(ansiEscapes.link(linkText, href.replace(/\+/g, '%20')));
  } else {
    // Chỉ hiển thị phần text (ví dụ: tên miền baomoi.com đã được rút gọn) trong terminal
    return this.o.link(this.o.href(this.emoji(text || href)));
  }
};

const driver = require('./driver');
const fileUtils = require('./utils/file');
const sseUtils = require('./utils/sse');
const screen = require('./tui/screen');
const editor = require('./tui/editor');

const chalkInstance = require('chalk').default || require('chalk');

function renderMarkdown(text, cols) {
  const extension = markedTerminal({
    reflowText: true,
    width: Math.max(40, cols - 4), // Trừ đi lề để hiển thị đẹp hơn
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

  const markedInstance = new Marked(extension);
  try {
    return markedInstance.parse(text).trimEnd();
  } catch (err) {
    return text;
  }
}

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

// Thay thế các ký hiệu [[N]] và [N] thành liên kết Markdown
function replaceCitations(text, docs) {
  if (!text) return text;

  // 1. Phân tích danh sách tài liệu tham khảo ở cuối văn bản (nếu có)
  // Định dạng thường gặp ở cuối: [21] Author... http://url hoặc [21] http://url
  const bibMap = {};
  const bibLineRegex = /^\s*\[(\d+)\]\s+(.+)$/gm;
  let match;
  bibLineRegex.lastIndex = 0;
  while ((match = bibLineRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const content = match[2];
    const urlMatch = content.match(/(https?:\/\/[^\s\)\],"`]+)/);
    if (urlMatch) {
      let url = urlMatch[1];
      if (url.endsWith('.') || url.endsWith(',')) {
        url = url.slice(0, -1);
      }
      let domain = '';
      try {
        domain = new URL(url).hostname;
      } catch (e) {
        const m = url.match(/https?:\/\/([^\/]+)/);
        domain = m ? m[1] : 'link';
      }
      if (domain.startsWith('www.')) domain = domain.slice(4);
      bibMap[num] = { url, domain };
    }
  }

  const getDomain = (url) => {
    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      const m = url.match(/https?:\/\/([^\/]+)/);
      domain = m ? m[1] : 'link';
    }
    if (domain.startsWith('www.')) domain = domain.slice(4);
    return domain;
  };

  // 2. Thay thế các ký hiệu [[N]] (ngoặc kép)
  text = text.replace(/\[\[(\d+)\]\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    if (bibMap[num]) {
      return `[[${numStr}]](${bibMap[num].url})`;
    }
    const idx = num - 1;
    if (docs && Array.isArray(docs) && docs[idx]) {
      const doc = docs[idx];
      return `[[${numStr}]](${doc.url})`;
    }
    return `[${numStr}]`;
  });

  // 3. Thay thế các ký hiệu [N] (ngoặc đơn)
  // Sử dụng lookbehind và lookahead nâng cao để tránh khớp nhầm code hoặc link Markdown có sẵn hoặc các dấu ngoặc kép vừa replace
  text = text.replace(/(?<!\w|\[)\[(\d+)\](?!\(|\[)/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    if (bibMap[num]) {
      return `[[${numStr}]](${bibMap[num].url})`;
    }
    const idx = num - 1;
    if (docs && Array.isArray(docs) && docs[idx]) {
      const doc = docs[idx];
      return `[[${numStr}]](${doc.url})`;
    }
    return match;
  });

  // 4. Thay thế các link URL thô còn lại thành link rút gọn chỉ hiển thị tên miền
  text = text.replace(/(?<!\(|\[)https?:\/\/[^\s\)\],"`]+/g, (url) => {
    let cleanUrl = url;
    if (cleanUrl.endsWith('.') || cleanUrl.endsWith(',')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    let domain = '';
    try {
      domain = new URL(cleanUrl).hostname;
    } catch (e) {
      const m = cleanUrl.match(/https?:\/\/([^\/]+)/);
      domain = m ? m[1] : 'link';
    }
    if (domain.startsWith('www.')) domain = domain.slice(4);
    return `[${domain}](${cleanUrl})`;
  });

  return text;
}

let chatHistory = [];

function rebuildScrollBuffer() {
  const cols = process.stdout.columns || 80;
  let formattedHistory = '';
  
  chatHistory.forEach((msg) => {
    if (msg.role === 'user') {
      const userBlock = editor.formatUserPromptBlock(msg.content, cols);
      formattedHistory += '\n' + userBlock + '\n';
    } else if (msg.role === 'assistant') {
      const parsedCitations = replaceCitations(msg.content, msg.docs);
      const renderedMarkdown = renderMarkdown(parsedCitations, cols);
      formattedHistory += `\n\x1b[1m\x1b[38;5;147m🤖 Qwen:\x1b[0m\n${renderedMarkdown}\n`;
    }
  });

  screen.setScrollContentBuffer(formattedHistory);
  screen.refreshScrollRegion();
}

let resolveDonePromise = null;
let streamBuffer = '';
let browserInitPromise = null;
let isBrowserReady = false;

function waitForResponse() {
  return new Promise((resolve) => {
    resolveDonePromise = resolve;
  });
}

async function triggerAutoExport() {
  const chatId = driver.getCurrentChatId();
  if (!chatId) return;
  await exportCurrentChat(chatId);
}

async function exportCurrentChat(chatId) {
  const chatData = await driver.getChatDetails(chatId);
  if (!chatData) {
    throw new Error(`Không thể tải chi tiết cuộc trò chuyện có ID: ${chatId}`);
  }

  let title = chatData.title || '';
  if (!title || title.trim().toLowerCase() === 'new chat') {
    const msgMap = chatData.chat?.messages || {};
    const userMsgs = Object.values(msgMap).filter(m => m.role === 'user');
    if (userMsgs.length > 0) {
      const sortedUserMsgs = userMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      title = sortedUserMsgs[0].content || '';
    }
  }

  function getSafeFilename(text, defaultName) {
    if (!text || text.trim() === '') return defaultName;
    return text
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  const safeTitle = getSafeFilename(title, `chat_${chatId}`);
  const outputDir = path.resolve(process.cwd(), 'output-qwen');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, `${safeTitle}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify([chatData], null, 2), 'utf8');

  const mdPath = path.join(outputDir, `${safeTitle}.md`);
  const mdContent = convertChatToMarkdown(chatData);
  fs.writeFileSync(mdPath, mdContent, 'utf8');
}

function convertChatToMarkdown(chatData) {
  let md = '';
  const title = chatData.title || 'Untitled Chat';
  md += `# ${title}\n\n`;
  md += `- **ID**: \`${chatData.id}\`\n`;
  
  const modelName = chatData.models ? chatData.models.join(', ') : 'unknown';
  md += `- **Model**: \`${modelName}\`\n`;
  
  if (chatData.created_at) {
    const date = new Date(chatData.created_at * 1000);
    md += `- **Created At**: \`${date.toLocaleString('vi-VN')}\`\n`;
  }
  md += `\n---\n\n`;

  const msgMap = chatData.chat && chatData.chat.messages ? chatData.chat.messages : {};
  const messages = Object.values(msgMap).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  messages.forEach((msg) => {
    if (msg.role === 'user') {
      md += `### 👤 User\n\n${msg.content || ''}\n\n---\n\n`;
    } else if (msg.role === 'assistant') {
      md += `### 🤖 Assistant\n\n`;

      if (msg.content_list && msg.content_list.length > 0) {
        const thinkingItems = msg.content_list.filter(item => item.phase === 'thinking_summary');
        if (thinkingItems.length > 0) {
          md += `<details>\n<summary>🧠 Thinking Process</summary>\n\n`;
          thinkingItems.forEach((tItem) => {
            const titles = tItem.extra && tItem.extra.summary_title ? tItem.extra.summary_title.content : [];
            const thoughts = tItem.extra && tItem.extra.summary_thought ? tItem.extra.summary_thought.content : [];
            for (let i = 0; i < titles.length; i++) {
              md += `- **${titles[i]}**`;
              if (thoughts[i]) {
                md += `: ${thoughts[i].trim()}`;
              }
              md += `\n`;
            }
          });
          md += `\n</details>\n\n`;
        }

        let searchDocs = [];
        msg.content_list.forEach((item) => {
          if (item.phase === 'web_search' && item.extra) {
            const docs = item.extra.web_search_info || (item.extra.tool_result && item.extra.tool_result.docs);
            if (docs && Array.isArray(docs)) {
              searchDocs = searchDocs.concat(docs);
            }
          }
        });

        if (searchDocs.length > 0) {
          md += `<details>\n<summary>🔍 Web Search References</summary>\n\n`;
          searchDocs.forEach((doc) => {
            if (doc.title && doc.url) {
              md += `- [${doc.title}](${doc.url})\n`;
            } else if (doc.url) {
              md += `- [${doc.url}](${doc.url})\n`;
            }
          });
          md += `\n</details>\n\n`;
        }
      }

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

      md += `${assistantContent}\n\n---\n\n`;
    }
  });

  return md.trim() + '\n';
}

function parseMarkdownToMessages(mdContent) {
  const lines = mdContent.split(/\r?\n/);
  const messages = [];
  let currentRole = null;
  let currentContentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('### 👤 User')) {
      if (currentRole && currentContentLines.length > 0) {
        messages.push({ role: currentRole, content: currentContentLines.join('\n').trim() });
      }
      currentRole = 'user';
      currentContentLines = [];
    } else if (line.startsWith('### 🤖 Assistant')) {
      if (currentRole && currentContentLines.length > 0) {
        messages.push({ role: currentRole, content: currentContentLines.join('\n').trim() });
      }
      currentRole = 'assistant';
      currentContentLines = [];
    } else {
      if (currentRole) {
        currentContentLines.push(line);
      }
    }
  }

  if (currentRole && currentContentLines.length > 0) {
    messages.push({ role: currentRole, content: currentContentLines.join('\n').trim() });
  }

  messages.forEach(msg => {
    msg.content = msg.content.replace(/\n---\s*$/, '').trim();
    if (msg.role === 'assistant') {
      msg.content = msg.content
        .replace(/<details>[\s\S]*?<\/details>/gi, '')
        .trim();
    }
  });

  return messages;
}

async function handleImportChat(filePath) {
  let resolvedPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Đường dẫn tệp không tồn tại: ${resolvedPath}`);
  }

  let importedData = null;
  let parsedMessages = [];
  const ext = path.extname(resolvedPath).toLowerCase();
  
  if (ext === '.json') {
    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    const rawData = JSON.parse(fileContent);
    importedData = Array.isArray(rawData) ? rawData[0] : rawData;
  } else if (ext === '.md') {
    const jsonPath = resolvedPath.slice(0, -ext.length) + '.json';
    if (fs.existsSync(jsonPath)) {
      screen.consoleLog(`[Hệ thống] Tìm thấy file JSON đi kèm: ${path.basename(jsonPath)}. Sẽ sử dụng để nhập đầy đủ dữ liệu.`);
      const fileContent = fs.readFileSync(jsonPath, 'utf8');
      const rawData = JSON.parse(fileContent);
      importedData = Array.isArray(rawData) ? rawData[0] : rawData;
    } else {
      screen.consoleLog(`[Hệ thống] Không thấy file JSON đi kèm. Tiến hành parse file Markdown...`);
      parsedMessages = parseMarkdownToMessages(fs.readFileSync(resolvedPath, 'utf8'));
    }
  } else {
    throw new Error('Chỉ hỗ trợ nhập từ tệp .json hoặc .md.');
  }

  if (importedData) {
    const msgMap = importedData.chat && importedData.chat.messages ? importedData.chat.messages : {};
    const sortedMsgs = Object.values(msgMap).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    sortedMsgs.forEach(msg => {
      if (msg.role === 'user') {
        parsedMessages.push({ role: 'user', content: msg.content || '' });
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
        parsedMessages.push({ role: 'assistant', content: assistantContent, docs: lastDocs });
      }
    });
  }

  if (parsedMessages.length === 0) {
    throw new Error('Không tìm thấy cuộc hội thoại hợp lệ nào để nhập.');
  }

  chatHistory = parsedMessages;
  rebuildScrollBuffer();
  screen.setScrollOffset(0);

  const basicHistory = parsedMessages.map(m => ({ role: m.role, content: m.content }));
  await driver.importChatHistory(basicHistory);
  
  screen.consoleLog(`[Hệ thống] Nhập lịch sử trò chuyện thành công! Đã khôi phục ${parsedMessages.length} tin nhắn.`);
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

  // Xử lý lệnh bật/tắt tự động xuất cuộc trò chuyện
  if (trimmedInput === '/export' || trimmedInput === '/ep') {
    const isNowEnabled = driver.toggleExportMode();
    screen.consoleLog(`[Hệ thống] Chế độ tự động xuất đoạn chat sang Markdown/JSON đã được: ${isNowEnabled ? 'BẬT (ON)' : 'TẮT (OFF)'}`);
    if (isNowEnabled) {
      const chatId = driver.getCurrentChatId();
      if (chatId) {
        screen.consoleLog(`[Hệ thống] Phát hiện cuộc hội thoại đang mở, đang tiến hành xuất lịch sử hiện tại...`);
        exportCurrentChat(chatId).then(() => {
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
      sseState.printedThoughts = [];
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
  screen.consoleLog('Nhập "/websearch" hoặc "/ws" để bật/tắt Tìm kiếm Web (Mặc định: TẮT).');
  screen.consoleLog('Nhập "/export" hoặc "/ep" để bật/tắt Tự động xuất chat sang Markdown/JSON (Mặc định: TẮT).');
  screen.consoleLog('Nhập "/import <path>" hoặc "/ip <path>" để khôi phục lịch sử trò chuyện.');
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
    screen.stopThinkingSpinner();
    
    // Xử lý nốt phần buffer còn lại nếu có
    if (streamBuffer.trim()) {
      sseState = sseUtils.parseSSEChunk(streamBuffer.trim(), sseState, (t) => {
        screen.printInScrollRegion(t);
      });
      streamBuffer = '';
    }
    
    // Lưu câu trả lời của AI vào lịch sử và render lại sạch sẽ vùng cuộn
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
    .then(() => {
      isBrowserReady = true;
    })
    .catch(async (err) => {
      screen.consoleError(`\n[Lỗi khởi động]: ${err.message}`);
      await screen.shutdownTUI();
    });

  // 3. Khởi tạo lắng nghe bàn phím và vẽ UI ngay lập tức để người dùng có thể nhập liệu/chọn tính năng
  try {
    screen.setResizeCallback(rebuildScrollBuffer);
    editor.setupTerminalInput(handleUserMessage, onResumeChat);
    editor.renderUI();
  } catch (err) {
    screen.consoleError(`\n[Lỗi hiển thị TUI]: ${err.message}`);
    await screen.shutdownTUI();
  }
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await screen.shutdownTUI();
});
