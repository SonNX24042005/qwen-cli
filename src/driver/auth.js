'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./launcher');

const BASE_URL = 'https://chat.qwen.ai';

// Hàm cập nhật token vào file .env
function updateEnvToken(newToken) {
  const envPath = path.join(__dirname, '../../.env');
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
  process.env.QWEN_TOKEN = newToken;
}

// Kiểm tra xem trang hiện tại có đang ở guest mode không
async function checkIsGuest(targetPage) {
  try {
    const url = targetPage.url();
    if (url.includes('/guest') || url.includes('/login')) return true;
    
    const content = await targetPage.textContent('body').catch(() => '');
    return content.includes('Log in') || content.includes('Sign up');
  } catch (e) {
    return true;
  }
}

// Khởi chạy chế độ đăng nhập tương tác (Headful)
async function runInteractiveLogin() {
  console.log('\n[Hệ thống] Đang mở trình duyệt (Headful Mode) để bạn đăng nhập...');
  console.log('[Hệ thống] Hãy đăng nhập tài khoản Qwen trên cửa sổ trình duyệt vừa hiện lên.');

  const loginBrowser = await launchBrowser({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const loginCtx = await loginBrowser.newContext();
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
        console.log('\n[Hệ thống] Đăng nhập thành công! Đã tự động lấy token xác thực.');
        updateEnvToken(detectedToken);
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
  BASE_URL
};
