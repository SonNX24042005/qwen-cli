'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./launcher');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { INIT_SCRIPT } = require('./hook');
const { 
  checkIsGuest, 
  runInteractiveLogin, 
  checkHasCaptcha, 
  loadSavedToken, 
  saveCredentials,
  getSavedCredentials,
  clearSavedCredentials,
  attemptAutoLogin,
  getStorageStatePath, 
  getConfigDir, 
  BASE_URL 
} = require('./auth');

const INPUT_SELECTOR = 'textarea.message-input-textarea, textarea:not([readonly]):not([disabled])';

let browser = null;
let context = null;
let page = null;

let currentOnChunk = null;
let currentOnDone = null;
let currentOnError = null;

let isWebSearchEnabled = false;
let currentThinkingMode = 'auto'; // 'auto' | 'thinking' | 'fast'

let isNewChatChatExportEnabled = false;
let autoExportSessions = new Set();
const autoExportConfigPath = path.resolve(process.cwd(), 'output-qwen/auto_export_sessions.json');

function loadAutoExportSessions() {
  try {
    if (fs.existsSync(autoExportConfigPath)) {
      const data = JSON.parse(fs.readFileSync(autoExportConfigPath, 'utf8'));
      autoExportSessions = new Set(data);
    }
  } catch (e) {
    // console.error(e);
  }
}

function saveAutoExportSessions() {
  try {
    const dir = path.dirname(autoExportConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(autoExportConfigPath, JSON.stringify(Array.from(autoExportSessions), null, 2), 'utf8');
  } catch (e) {
    // console.error(e);
  }
}

loadAutoExportSessions();


async function syncPageState(targetPage, importedHistory = null) {
  if (!targetPage) return;
  await targetPage.evaluate(({ status, mName, tMode, hist }) => {
    window.__qwenWebSearchEnabled = status;
    window.__qwenModelName = mName;
    window.__qwenThinkingMode = tMode;
    window.__qwenImportedHistory = hist;
  }, {
    status: isWebSearchEnabled,
    mName: currentModelName,
    tMode: currentThinkingMode,
    hist: importedHistory
  }).catch(() => {});
}

// Khởi chạy chế độ giải Captcha tương tác (Headful)
async function runInteractiveCaptchaSolver(failedPromptText) {
  console.log('\n[Hệ thống] Phát hiện Captcha bảo mật (RGV587) từ Alibaba WAF.');
  console.log('[Hệ thống] Đang mở trình duyệt (Headful Mode) để bạn xác thực...');
  console.log('[Hệ thống] Vui lòng kéo thanh slider captcha trên cửa sổ trình duyệt.');

  await closeBrowser().catch(() => {});

  const storageStatePath = getStorageStatePath();
  const contextOptions = {
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  };
  if (fs.existsSync(storageStatePath)) {
    try {
      contextOptions.storageState = storageStatePath;
    } catch (e) {}
  }

  const captchaBrowser = await launchBrowser(contextOptions);
  const captchaCtx = await captchaBrowser.newContext(contextOptions.storageState ? { storageState: storageStatePath } : {});

  const token = loadSavedToken();
  if (token) {
    await captchaCtx.addCookies([
      { name: 'token', value: token, domain: 'chat.qwen.ai', path: '/' }
    ]).catch(() => {});
    await captchaCtx.addInitScript(INIT_SCRIPT(token));
  }

  const captchaPage = await captchaCtx.newPage();
  await syncPageState(captchaPage);

  await captchaPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await captchaPage.waitForSelector(INPUT_SELECTOR, { timeout: 15000 }).catch(() => {});

  if (failedPromptText) {
    await captchaPage.fill(INPUT_SELECTOR, failedPromptText);
    await captchaPage.press(INPUT_SELECTOR, 'Enter').catch(() => {});
  }

  let captchaCleared = false;
  for (let i = 0; i < 60; i++) {
    await captchaPage.waitForTimeout(1500);
    const hasCaptcha = await checkHasCaptcha(captchaPage);
    if (!hasCaptcha) {
      const chatItemExist = await captchaPage.evaluate(() => {
        return document.querySelectorAll('[class*="message"], [class*="bubble"]').length > 0;
      }).catch(() => false);
      
      if (chatItemExist) {
        console.log('[Hệ thống] Xác thực Captcha thành công! Đang chuyển về chế độ CLI ngầm...');
        captchaCleared = true;
        break;
      }
    }
  }

  await captchaBrowser.close().catch(() => {});

  if (currentOnChunk && currentOnDone && currentOnError) {
    await initBrowser(currentOnChunk, currentOnDone, currentOnError);
  }
}

// Bật/Tắt Web Search từ Node.js và cập nhật biến trong Browser Context
async function setWebSearch(enabled) {
  isWebSearchEnabled = !!enabled;
  if (page) {
    await page.evaluate((status) => {
      window.__qwenWebSearchEnabled = status;
    }, isWebSearchEnabled).catch(() => {});
  }
}

function getWebSearch() {
  return isWebSearchEnabled;
}

// Tải file đính kèm lên Qwen Chat thông qua Playwright input file
async function uploadFile(filePath) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');

  // Chuyển đổi đường dẫn tương đối thành tuyệt đối dựa theo CWD (thư mục chạy CLI)
  let resolvedPath;
  if (path.isAbsolute(filePath)) {
    resolvedPath = path.resolve(filePath);
  } else {
    resolvedPath = path.resolve(process.cwd(), filePath);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File không tồn tại tại đường dẫn: ${resolvedPath}`);
  }

  // 1. Tính toán đường dẫn tương đối so với CWD
  const relativePath = path.relative(process.cwd(), resolvedPath);
  const ext = path.extname(resolvedPath);
  
  const safeRelativeName = relativePath
    .split(path.sep)
    .join('--')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');

  const debugDir = path.resolve(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const tempFilePath = path.join(debugDir, safeRelativeName);
  
  try {
    let content = fs.readFileSync(resolvedPath, 'utf8');
    
    const lowerExt = ext.toLowerCase();
    const textExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.html', '.css', '.yaml', '.yml'];
    
    if (textExtensions.includes(lowerExt)) {
      let header = '';
      if (['.js', '.jsx', '.ts', '.tsx', '.css'].includes(lowerExt)) {
        header = `// [Đường dẫn dự án thực tế: ${relativePath}]\n\n`;
      } else if (['.html', '.md'].includes(lowerExt)) {
        header = `<!-- Đường dẫn dự án thực tế: ${relativePath} -->\n\n`;
      } else if (['.json', '.yaml', '.yml', '.txt'].includes(lowerExt)) {
        header = `# Đường dẫn dự án thực tế: ${relativePath}\n\n`;
      }
      content = header + content;
    }
    
    fs.writeFileSync(tempFilePath, content, 'utf8');
  } catch (err) {
    try {
      fs.copyFileSync(resolvedPath, tempFilePath);
    } catch (copyErr) {
      throw new Error(`Không thể chuẩn bị tệp tạm thời để tải lên: ${copyErr.message}`);
    }
  }

  console.log(`[Driver] Đang tải file lên Qwen: ${safeRelativeName} (Gốc: ${relativePath})...`);
  
  try {
    await page.click('.mode-select');
    await page.waitForTimeout(500);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.click('text="Upload attachment"')
    ]);

    await fileChooser.setFiles(tempFilePath);
    
    await page.waitForTimeout(5000);
    console.log(`[Driver] Tải file lên thành công: ${safeRelativeName}`);
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (cleanupErr) {
      console.warn(`[Cảnh báo]: Không thể xóa file tạm ${tempFilePath}: ${cleanupErr.message}`);
    }
  }
}

async function initBrowser(onChunk, onDone, onError) {
  currentOnChunk = onChunk;
  currentOnDone = onDone;
  currentOnError = onError;

  let token = loadSavedToken();

  // 1. Nếu chưa có token hoặc hết hạn, thử tự động đăng nhập ngầm bằng tài khoản & mật khẩu đã lưu
  const savedCreds = getSavedCredentials();
  if ((!token || token.trim() === '') && savedCreds && savedCreds.account && savedCreds.password) {
    try {
      const autoToken = await attemptAutoLogin(savedCreds.account, savedCreds.password);
      if (autoToken) {
        token = autoToken;
      }
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS' || err.message === 'INVALID_CREDENTIALS') {
        console.log('\n[LỖI ĐĂNG NHẬP TỰ ĐỘNG] ❌ Mật khẩu hoặc tài khoản đã lưu KHÔNG CHÍNH XÁC!');
        console.log('[Hệ thống] Đã tự động xóa thông tin tài khoản/mật khẩu sai khỏi bộ nhớ.');
        clearSavedCredentials();
      } else {
        console.log('[Driver] Tự động đăng nhập ngầm thất bại, sẽ mở đăng nhập tương tác...');
      }
    }
  }

  // 2. Nếu vẫn chưa có token, mở trình duyệt cho người dùng tự đăng nhập tương tác
  if (!token || token.trim() === '') {
    await runInteractiveLogin();
    token = loadSavedToken();
  }

  console.log('[Driver] Đang khởi chạy Chromium ẩn danh...');
  
  const storageStatePath = getStorageStatePath();
  const contextOptions = {};
  if (fs.existsSync(storageStatePath)) {
    try {
      contextOptions.storageState = storageStatePath;
    } catch (e) {}
  }

  browser = await launchBrowser({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--mute-audio'
    ]
  });

  context = await browser.newContext(contextOptions);

  if (token) {
    await context.addCookies([
      { name: 'token', value: token, domain: 'chat.qwen.ai', path: '/' }
    ]).catch(() => {});
    await context.addInitScript(INIT_SCRIPT(token));
  }

  page = await context.newPage();

  // Đăng ký IPC callbacks
  await page.exposeFunction('__qwenChunk', async (encodedStr) => {
    const decodedStr = decodeURIComponent(encodedStr);
    
    if (decodedStr.includes('FAIL_SYS_USER_VALIDATE') || decodedStr.includes('RGV587')) {
      await runInteractiveCaptchaSolver();
      return;
    }

    onChunk(decodedStr);
  });

  await page.exposeFunction('__qwenDone', () => {
    onDone();
  });

  await page.exposeFunction('__qwenErr', (errMsg) => {
    onError(errMsg);
  });

  console.log(`[Driver] Đang truy cập ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Chờ ô nhập liệu xuất hiện HOẶC chờ chuyển hướng sang trang guest/login
  console.log('[Driver] Chờ xác thực phiên làm việc...');
  try {
    await Promise.race([
      page.waitForSelector(INPUT_SELECTOR, { timeout: 15000 }),
      page.waitForURL((url) => url.href.includes('/guest') || url.href.includes('/login'), { timeout: 15000 })
    ]);
  } catch (e) {}

  const isGuest = await checkIsGuest(page);
  if (isGuest) {
    console.log('[Driver] Token hoặc phiên làm việc hiện tại đã hết hạn.');
    
    // Thử tự động đăng nhập lại bằng tài khoản mật khẩu đã lưu
    const creds = getSavedCredentials();
    if (creds && creds.account && creds.password) {
      try {
        const autoToken = await attemptAutoLogin(creds.account, creds.password);
        if (autoToken) {
          await closeBrowser().catch(() => {});
          await initBrowser(onChunk, onDone, onError);
          return;
        }
      } catch (err) {
        if (err.code === 'INVALID_CREDENTIALS' || err.message === 'INVALID_CREDENTIALS') {
          console.log('\n[LỖI ĐĂNG NHẬP TỰ ĐỘNG] ❌ Mật khẩu hoặc tài khoản đã lưu KHÔNG CHÍNH XÁC!');
          console.log('[Hệ thống] Đã xóa thông tin tài khoản/mật khẩu sai khỏi bộ nhớ.');
          clearSavedCredentials();
        }
      }
    }

    await closeBrowser().catch(() => {});
    await runInteractiveLogin();
    await initBrowser(onChunk, onDone, onError);
    return;
  }

  await syncPageState(page);

  // Cập nhật storageState mới nhất sau khi khởi tạo thành công
  try {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    await context.storageState({ path: storageStatePath });
  } catch (e) {}

  await page.waitForTimeout(1000);
  
  console.log('[Driver] Kết nối thành công và đã sẵn sàng chat!');
}

async function sendPrompt(promptText) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');

  const hasCaptcha = await checkHasCaptcha(page);
  if (hasCaptcha) {
    await runInteractiveCaptchaSolver(promptText);
    return;
  }

  console.log('[Driver] Đang điền prompt...');
  await page.fill(INPUT_SELECTOR, promptText);
  
  console.log('[Driver] Đang gửi tin nhắn (nhấn Enter)...');
  await page.press(INPUT_SELECTOR, 'Enter');

  await page.waitForTimeout(1000);
  const postSubmitCaptcha = await checkHasCaptcha(page);
  if (postSubmitCaptcha) {
    await runInteractiveCaptchaSolver(promptText);
  }
}

let currentModelName = 'qwen3.7-plus';

async function setModelName(modelName) {
  currentModelName = modelName;
  if (page) {
    await page.evaluate((mName) => {
      window.__qwenModelName = mName;
    }, currentModelName).catch(() => {});
  }
}

function getModelName() {
  return currentModelName;
}

async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    context = null;
    page = null;
  }
}

async function setThinkingMode(tMode) {
  currentThinkingMode = tMode;
  if (page) {
    await page.evaluate((mode) => {
      window.__qwenThinkingMode = mode;
    }, currentThinkingMode).catch(() => {});
  }
}
function getThinkingMode() {
  return currentThinkingMode;
}

let isDetailedThinkingEnabled = false;

function isDetailedThinking() {
  return isDetailedThinkingEnabled;
}

function toggleDetailedThinking() {
  isDetailedThinkingEnabled = !isDetailedThinkingEnabled;
  return isDetailedThinkingEnabled;
}

function setDetailedThinking(val) {
  isDetailedThinkingEnabled = !!val;
}

async function getChatHistory(pageNumber = 1) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');
  
  return await page.evaluate(async (pNum) => {
    try {
      const res = await fetch(`/api/v2/chats/?page=${pNum}&exclude_project=true`);
      const json = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.error('Error fetching history:', e);
      return [];
    }
  }, pageNumber);
}

async function getChatDetails(chatId) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');
  
  return await page.evaluate(async (id) => {
    try {
      const res = await fetch(`/api/v2/chats/${id}`);
      const json = await res.json();
      return json.success ? json.data : null;
    } catch (e) {
      console.error('Error fetching chat details:', e);
      return null;
    }
  }, chatId);
}

async function resumeChat(chatId) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');
  
  const targetUrl = `${BASE_URL}/c/${chatId}`;
  console.log(`[Driver] Đang chuyển sang cuộc trò chuyện: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
  await page.waitForTimeout(2000);
}

async function newChat() {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');
  
  console.log(`[Driver] Đang quay lại trang chủ để tạo cuộc trò chuyện mới...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
  
  await syncPageState(page);

  await page.waitForTimeout(2000);
}

function getCurrentChatId() {
  if (!page) return null;
  const url = page.url();
  const match = url.match(/\/c\/([a-f0-9\-]+)/);
  return match ? match[1] : null;
}

async function importChatHistory(history) {
  if (!page) throw new Error('Trình duyệt chưa được khởi tạo.');
  
  console.log(`[Driver] Đang quay lại trang chủ để chuẩn bị nhập lịch sử trò chuyện...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
  
  await syncPageState(page, history);

  await page.waitForTimeout(2000);
}

function isExportModeEnabled() {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return isNewChatChatExportEnabled;
  }
  return autoExportSessions.has(chatId);
}

function toggleExportMode() {
  const chatId = getCurrentChatId();
  if (!chatId) {
    isNewChatChatExportEnabled = !isNewChatChatExportEnabled;
    return isNewChatChatExportEnabled;
  }
  
  loadAutoExportSessions();
  if (autoExportSessions.has(chatId)) {
    autoExportSessions.delete(chatId);
  } else {
    autoExportSessions.add(chatId);
  }
  saveAutoExportSessions();
  return autoExportSessions.has(chatId);
}

function setExportMode(enabled) {
  const chatId = getCurrentChatId();
  if (!chatId) {
    isNewChatChatExportEnabled = !!enabled;
    return;
  }
  loadAutoExportSessions();
  if (enabled) {
    autoExportSessions.add(chatId);
  } else {
    autoExportSessions.delete(chatId);
  }
  saveAutoExportSessions();
}

function checkAndSyncNewChatExport() {
  if (isNewChatChatExportEnabled) {
    const chatId = getCurrentChatId();
    if (chatId) {
      loadAutoExportSessions();
      autoExportSessions.add(chatId);
      saveAutoExportSessions();
      isNewChatChatExportEnabled = false;
      return chatId;
    }
  }
  return null;
}

/**
 * Lấy danh sách mô hình thực tế từ API của Qwen.
 * Được gọi sau khi initBrowser() hoàn tất.
 * Response thực tế: { success: true, data: { data: [...] } }
 * @returns {Promise<Array<{display:string, value:string}>>}
 */
async function getModelsFromWeb() {
  if (!page) return [];
  try {
    const models = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/v2/models/');
        if (!res.ok) return [];
        const json = await res.json();

        // Cấu trúc thực tế: { success: true, data: { data: [...] } }
        // Hỗ trợ cả: { success, data: [...] }, mảng trực tiếp (fallback)
        let list = [];
        if (json.success) {
          if (json.data && Array.isArray(json.data.data)) {
            list = json.data.data;          // { data: { data: [...] } }
          } else if (Array.isArray(json.data)) {
            list = json.data;               // { data: [...] }
          }
        } else if (Array.isArray(json)) {
          list = json;                      // mảng trực tiếp
        }

        return list
          .filter(m => m && (m.id || m.model))
          .map(m => ({
            display: m.name || m.title || m.id || m.model,
            value: m.id || m.model
          }));
      } catch (_) {
        return [];
      }
    });
    return Array.isArray(models) ? models : [];
  } catch (_) {
    return [];
  }
}

module.exports = {
  initBrowser,
  sendPrompt,
  closeBrowser,
  setWebSearch,
  getWebSearch,
  uploadFile,
  setModelName,
  getModelName,
  setThinkingMode,
  getThinkingMode,
  isDetailedThinking,
  toggleDetailedThinking,
  setDetailedThinking,
  getChatHistory,
  getChatDetails,
  resumeChat,
  newChat,
  getCurrentChatId,
  importChatHistory,
  isExportModeEnabled,
  toggleExportMode,
  setExportMode,
  checkAndSyncNewChatExport,
  getModelsFromWeb,
  saveCredentials,
  getSavedCredentials,
  clearSavedCredentials
};
