'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { INIT_SCRIPT } = require('./hook');
const { checkIsGuest, runInteractiveLogin, checkHasCaptcha, BASE_URL } = require('./auth');

const INPUT_SELECTOR = 'textarea.message-input-textarea, textarea:not([readonly]):not([disabled])';

let browser = null;
let context = null;
let page = null;

let currentOnChunk = null;
let currentOnDone = null;
let currentOnError = null;

let isWebSearchEnabled = false;
let currentThinkingMode = 'auto'; // 'auto' | 'thinking' | 'fast'


// Khởi chạy chế độ giải Captcha tương tác (Headful)
async function runInteractiveCaptchaSolver(failedPromptText) {
  console.log('\n[Hệ thống] Phát hiện Captcha bảo mật (RGV587) từ Alibaba WAF.');
  console.log('[Hệ thống] Đang mở trình duyệt (Headful Mode) để bạn xác thực...');
  console.log('[Hệ thống] Vui lòng kéo thanh slider captcha trên cửa sổ trình duyệt.');

  await closeBrowser().catch(() => {});

  const captchaBrowser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const token = process.env.QWEN_TOKEN;
  const captchaCtx = await captchaBrowser.newContext();
  await captchaCtx.addCookies([
    { name: 'token', value: token, domain: 'chat.qwen.ai', path: '/' }
  ]);
  await captchaCtx.addInitScript(INIT_SCRIPT(token));

  const captchaPage = await captchaCtx.newPage();
  
  await captchaPage.evaluate((status) => {
    window.__qwenWebSearchEnabled = status;
  }, isWebSearchEnabled);

  await captchaPage.evaluate((mName) => {
    window.__qwenModelName = mName;
  }, currentModelName);

  await captchaPage.evaluate((tMode) => {
    window.__qwenThinkingMode = tMode;
  }, currentThinkingMode);

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
    }, isWebSearchEnabled);
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
  
  // Sử dụng ký tự gạch ngang kép '--' để thay thế cho dấu phân cách thư mục (path.sep).
  // Điều này giúp phân biệt rõ ràng với dấu gạch dưới '_' vốn có thể nằm trong tên file gốc (ví dụ: ten_file.md).
  // Kết quả chuyển đổi:
  // - 'sub/folder/ten_file.md'   -> 'sub--folder--ten_file.md'
  // - 'sub_folder/ten_file.md'   -> 'sub_folder--ten_file.md'
  const safeRelativeName = relativePath
    .replace(new RegExp('\\' + path.sep, 'g'), '--')
    .replace(/[^a-zA-Z0-9_.-]/g, '_'); // Thay các ký tự không an toàn khác bằng '_'

  const debugDir = path.resolve(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  // Tạo file tạm chứa tên cấu trúc tương đối
  const tempFilePath = path.join(debugDir, safeRelativeName);
  
  try {
    let content = fs.readFileSync(resolvedPath, 'utf8');
    
    // Chỉ chèn chú thích đường dẫn nếu là file văn bản phổ biến
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
    // Nếu là file binary (ảnh, pdf) không đọc được dạng text, chỉ copy trực tiếp tệp gốc sang tên mới
    try {
      fs.copyFileSync(resolvedPath, tempFilePath);
    } catch (copyErr) {
      throw new Error(`Không thể chuẩn bị tệp tạm thời để tải lên: ${copyErr.message}`);
    }
  }

  console.log(`[Driver] Đang tải file lên Qwen: ${safeRelativeName} (Gốc: ${relativePath})...`);
  
  try {
    // 1. Click mở menu dấu cộng (+) của ô chat
    await page.click('.mode-select');
    await page.waitForTimeout(500);

    // 2. Chờ sự kiện chọn file từ hệ thống xuất hiện khi click vào "Upload attachment"
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.click('text="Upload attachment"')
    ]);

    // 3. Gán file tạm vào file chooser
    await fileChooser.setFiles(tempFilePath);
    
    // 4. Chờ 5 giây để Qwen Web thực thi tiến trình upload file lên server
    await page.waitForTimeout(5000);
    console.log(`[Driver] Tải file lên thành công: ${safeRelativeName}`);
  } finally {
    // 5. Tự động dọn dẹp file tạm để giữ thư mục debug sạch sẽ
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

  let token = process.env.QWEN_TOKEN;

  if (!token || token.trim() === '') {
    await runInteractiveLogin();
    token = process.env.QWEN_TOKEN;
  }

  console.log('[Driver] Đang khởi chạy Chromium ẩn danh...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--mute-audio'
    ]
  });

  context = await browser.newContext();
  await context.addCookies([
    { name: 'token', value: token, domain: 'chat.qwen.ai', path: '/' }
  ]);
  await context.addInitScript(INIT_SCRIPT(token));

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

  const isGuest = await checkIsGuest(page);
  if (isGuest) {
    console.log('[Driver] Token hiện tại đã hết hạn hoặc không hợp lệ.');
    await closeBrowser().catch(() => {});
    await runInteractiveLogin();
    await initBrowser(onChunk, onDone, onError);
    return;
  }

  console.log('[Driver] Chờ tải ô nhập liệu...');
  await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
  
  await page.evaluate((status) => {
    window.__qwenWebSearchEnabled = status;
  }, isWebSearchEnabled);

  await page.evaluate((mName) => {
    window.__qwenModelName = mName;
  }, currentModelName);

  await page.evaluate((tMode) => {
    window.__qwenThinkingMode = tMode;
  }, currentThinkingMode);

  await page.waitForTimeout(2000);
  
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
    }, currentModelName);
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
    }, currentThinkingMode);
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
  resumeChat
};
