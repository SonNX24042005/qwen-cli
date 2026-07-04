'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { spawnSync } = require('child_process');
const path = require('path');

async function launchBrowser(options) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    const errMsg = err.message || '';
    if (
      errMsg.includes('install') || 
      errMsg.includes('download') || 
      errMsg.includes('Executable') || 
      errMsg.includes('not found') || 
      errMsg.includes('ENOENT')
    ) {
      console.log('\n[Driver] Phát hiện trình duyệt Chromium của Playwright chưa được tải.');
      console.log('[Driver] Đang tự động tải Chromium (chỉ chạy một lần duy nhất, vui lòng chờ)...');
      
      const cli = path.join(path.dirname(require.resolve('playwright')), 'cli.js');
      const result = spawnSync('node', [cli, 'install', 'chromium'], { stdio: 'inherit' });
      if (result.status === 0) {
        console.log('[Driver] Tải trình duyệt thành công! Đang tiếp tục khởi động...');
        return await chromium.launch(options);
      } else {
        throw new Error('Không thể tải tự động trình duyệt Chromium. Vui lòng chạy lệnh: npx playwright install chromium');
      }
    } else {
      throw err;
    }
  }
}

module.exports = { launchBrowser };
