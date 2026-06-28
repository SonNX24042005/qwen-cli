'use strict';

const fs = require('fs');
const path = require('path');
const driver = require('../src/driver');

const logFile = path.join(__dirname, '../debug/raw_chunks.txt');
try { fs.unlinkSync(logFile); } catch (e) {}

let currentResponseText = '';

function parseSSEChunk(rawText) {
  fs.appendFileSync(logFile, `--- NEW CHUNK ---\n${rawText}\n`);

  const lines = rawText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const dataJson = trimmed.slice(5).trim();
    if (!dataJson || dataJson === '[DONE]') continue;

    try {
      const parsed = JSON.parse(dataJson);
      const choices = parsed.choices;
      if (choices && choices[0]) {
        const delta = choices[0].delta;
        if (delta && delta.content) {
          const incomingText = delta.content;
          
          if (incomingText.startsWith(currentResponseText) && incomingText.length > currentResponseText.length) {
            const diffText = incomingText.slice(currentResponseText.length);
            process.stdout.write(diffText);
            currentResponseText = incomingText;
          } else if (!incomingText.startsWith(currentResponseText)) {
            process.stdout.write(incomingText);
            currentResponseText += incomingText;
          }
        }
      }
    } catch (e) {}
  }
}

async function main() {
  console.log('[Test] Đang khởi chạy và kết nối với Qwen Chat...');

  const onChunk = (chunkText) => {
    parseSSEChunk(chunkText);
  };

  const onDone = async () => {
    console.log('\n\n[Test] Nhận phản hồi hoàn tất. Đang đóng trình duyệt...');
    await driver.closeBrowser();
    console.log('[Test] Thành công!');
    process.exit(0);
  };

  const onError = async (errMsg) => {
    console.error(`\n\n[Test] Lỗi stream: ${errMsg}`);
    await driver.closeBrowser();
    process.exit(1);
  };

  try {
    await driver.initBrowser(onChunk, onDone, onError);
    console.log('\n[Test] Đang gửi câu hỏi: "Xin chào, hãy giới thiệu ngắn gọn về bản thân."');
    await driver.sendPrompt('Xin chào, hãy giới thiệu ngắn gọn về bản thân.');
  } catch (err) {
    console.error(`\n[Test Lỗi khởi động]: ${err.message}`);
    await driver.closeBrowser();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Fatal test error:', err);
  await driver.closeBrowser();
  process.exit(1);
});
