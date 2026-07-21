'use strict';

const fs = require('fs');
const path = require('path');
const driver = require('../driver');

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

async function loadImportedChatData(filePath, consoleLogFn) {
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
      if (consoleLogFn) consoleLogFn(`[Hệ thống] Tìm thấy file JSON đi kèm: ${path.basename(jsonPath)}. Sẽ sử dụng để nhập đầy đủ dữ liệu.`);
      const fileContent = fs.readFileSync(jsonPath, 'utf8');
      const rawData = JSON.parse(fileContent);
      importedData = Array.isArray(rawData) ? rawData[0] : rawData;
    } else {
      if (consoleLogFn) consoleLogFn(`[Hệ thống] Không thấy file JSON đi kèm. Tiến hành parse file Markdown...`);
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

  return parsedMessages;
}

module.exports = {
  convertChatToMarkdown,
  parseMarkdownToMessages,
  exportCurrentChat,
  loadImportedChatData
};
