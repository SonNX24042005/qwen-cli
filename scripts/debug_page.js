'use strict';

const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TOKEN = process.env.QWEN_TOKEN;
const BASE_URL = 'https://chat.qwen.ai';
const INPUT_SELECTOR = 'textarea.message-input-textarea, textarea';

async function main() {
  console.log('Khởi chạy Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'token',
      value: TOKEN,
      domain: 'chat.qwen.ai',
      path: '/'
    }
  ]);

  const page = await context.newPage();
  console.log(`Đang truy cập ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Chờ 5 giây...');
  await page.waitForTimeout(5000);

  console.log('Đang điền prompt...');
  await page.fill(INPUT_SELECTOR, 'Xin chào, hãy giới thiệu ngắn gọn về bản thân.');
  
  console.log('Chờ 1 giây và chụp ảnh sau khi điền...');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, '../debug/debug_after_fill.png') });

  // Tìm tất cả các button gần ô input để debug xem button nào là button Send
  const buttonsInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => ({
      id: b.id,
      className: b.className,
      ariaLabel: b.getAttribute('aria-label'),
      type: b.type,
      text: b.textContent.trim(),
      disabled: b.disabled
    }));
  });
  console.log('Danh sách các buttons trên trang:', JSON.stringify(buttonsInfo, null, 2));

  console.log('Đang nhấn gửi bằng click...');
  const sendClicked = await page.evaluate(() => {
    const sendBtn = document.querySelector('button.send-button') || 
                    document.querySelector('button[aria-label*="send" i]') || 
                    document.querySelector('button[type="submit"]');
    if (sendBtn) {
      sendBtn.click();
      return 'Clicked: ' + (sendBtn.className || sendBtn.id);
    }
    return 'No button found';
  });
  console.log('Kết quả click gửi:', sendClicked);

  console.log('Chờ 8 giây xem AI phản hồi...');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(__dirname, '../debug/debug_after_send.png') });

  await browser.close();
  console.log('Hoàn thành debug.');
}

main().catch(console.error);
