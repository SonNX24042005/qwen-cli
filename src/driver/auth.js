'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchBrowser } = require('./launcher');

const BASE_URL = 'https://chat.qwen.ai';

const CONFIG_DIR = path.join(os.homedir(), '.qwen-cli');
const STORAGE_STATE_PATH = path.join(CONFIG_DIR, 'storage_state.json');
const USER_ENV_PATH = path.join(CONFIG_DIR, '.env');
const PROJECT_ENV_PATH = path.join(__dirname, '../../.env');

function getStorageStatePath() {
  return STORAGE_STATE_PATH;
}

function getConfigDir() {
  return CONFIG_DIR;
}

// Đọc token đã lưu từ file .env ở thư mục cá nhân hoặc thư mục dự án
function loadSavedToken() {
  if (process.env.QWEN_TOKEN && process.env.QWEN_TOKEN.trim() !== '') {
    return process.env.QWEN_TOKEN;
  }

  const envPaths = [USER_ENV_PATH, PROJECT_ENV_PATH];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/QWEN_TOKEN=(.*)/);
        if (match && match[1] && match[1].trim() !== '') {
          process.env.QWEN_TOKEN = match[1].trim();
          return process.env.QWEN_TOKEN;
        }
      } catch (e) {}
    }
  }
  return null;
}

// Hàm cập nhật token vào file .env ở cả thư mục cá nhân (~/.qwen-cli/.env) và dự án
function updateEnvToken(newToken) {
  process.env.QWEN_TOKEN = newToken;

  const envPaths = [USER_ENV_PATH, PROJECT_ENV_PATH];
  for (const envPath of envPaths) {
    try {
      const dir = path.dirname(envPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      if (envContent.includes('QWEN_TOKEN=')) {
        envContent = envContent.replace(/QWEN_TOKEN=.*/, `QWEN_TOKEN=${newToken}`);
      } else {
        envContent += `\nQWEN_TOKEN=${newToken}\n`;
      }
      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    } catch (e) {}
  }
}

// Kiểm tra xem trang hiện tại có đang ở guest mode không
async function checkIsGuest(targetPage) {
  try {
    const url = targetPage.url();
    if (url.includes('/guest') || url.includes('/login')) return true;
    
    // Nếu đã xuất hiện ô nhập liệu textarea thì chắc chắn KHÔNG phải guest
    const hasInput = await targetPage.$('textarea.message-input-textarea, textarea:not([readonly]):not([disabled])').catch(() => null);
    if (hasInput) return false;

    const content = await targetPage.textContent('body').catch(() => '');
    if (content.includes('Log in') && content.includes('Sign up')) {
      return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

// Khởi chạy chế độ đăng nhập tương tác (Headful)
async function runInteractiveLogin() {
  console.log('\n[Hệ thống] Đang mở trình duyệt (Headful Mode) để bạn đăng nhập...');
  console.log('[Hệ thống] Hãy đăng nhập tài khoản Qwen trên cửa sổ trình duyệt vừa hiện lên.');

  const contextOptions = {
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  };

  if (fs.existsSync(STORAGE_STATE_PATH)) {
    try {
      contextOptions.storageState = STORAGE_STATE_PATH;
    } catch (e) {}
  }

  const loginBrowser = await launchBrowser(contextOptions);
  const loginCtx = await loginBrowser.newContext(contextOptions.storageState ? { storageState: STORAGE_STATE_PATH } : {});
  const loginPage = await loginCtx.newPage();
  await loginPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  let detectedToken = null;

  // Vòng lặp kiểm tra trạng thái đăng nhập thành công để lấy token
  for (let i = 0; i < 120; i++) { // Chờ tối đa 3 phút (120 * 1500ms)
    await loginPage.waitForTimeout(1500);

    const isGuest = await checkIsGuest(loginPage);
    const url = loginPage.url();

    if (!isGuest && url.includes('chat.qwen.ai')) {
      detectedToken = await loginPage.evaluate(() => {
        return localStorage.getItem('token') || localStorage.getItem('active_token');
      }).catch(() => null);

      if (!detectedToken) {
        const cookies = await loginCtx.cookies();
        const tokenCookie = cookies.find(c => c.name === 'token');
        if (tokenCookie && tokenCookie.value) {
          detectedToken = tokenCookie.value;
        }
      }

      if (detectedToken && detectedToken.length > 50) {
        console.log('\n[Hệ thống] Đăng nhập thành công! Đã tự động lưu token và phiên làm việc (storageState).');
        updateEnvToken(detectedToken);

        // Lưu lại toàn bộ storageState (cookies + localStorage) vào file cấu hình người dùng
        try {
          if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
          }
          await loginCtx.storageState({ path: STORAGE_STATE_PATH });
        } catch (saveErr) {
          console.warn('[Driver] Không thể lưu storageState:', saveErr.message);
        }
        break;
      }
    }
  }

  await loginBrowser.close().catch(() => {});

  if (!detectedToken) {
    throw new Error('Đăng nhập quá hạn hoặc thất bại.');
  }
}

// Kiểm tra xem trang có đang hiển thị Captcha không
async function checkHasCaptcha(targetPage) {
  try {
    const raw = await targetPage.evaluate(() => {
      const t = (document.body && document.body.innerText) || '';
      return /Access Verification|slide to verify|drag the slider|verify that you are a real person|Please complete the operation|滑块|拖动|哎哟喂/i.test(t);
    });
    return !!raw;
  } catch (e) {
    return false;
  }
}

module.exports = {
  checkIsGuest,
  runInteractiveLogin,
  checkHasCaptcha,
  loadSavedToken,
  getStorageStatePath,
  getConfigDir,
  BASE_URL
};
