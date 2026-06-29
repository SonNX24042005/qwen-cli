'use strict';

const driver = require('../driver');

// Trạng thái vùng cuộn
let scrollContentBuffer = '';
let scrollOffset = 0;

// Callback dùng để render ô nhập liệu khi cuộn/resize màn hình
let renderUICallback = () => {};

function setRenderUICallback(cb) {
  renderUICallback = cb;
}

// Hàm vẽ lại vùng cuộn dựa trên chiều cao terminal hiện tại và scrollOffset
function refreshScrollRegion() {
  const rows = process.stdout.rows || 24;
  const maxLines = rows - 2; // Chiều cao tối đa của vùng cuộn

  const allLines = scrollContentBuffer.split('\n');
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }

  // Giới hạn scrollOffset trong phạm vi hợp lệ
  const maxScroll = Math.max(0, allLines.length - maxLines);
  if (scrollOffset > maxScroll) scrollOffset = maxScroll;
  if (scrollOffset < 0) scrollOffset = 0;

  // Cắt danh sách các dòng cần hiển thị
  const startIdx = Math.max(0, allLines.length - maxLines - scrollOffset);
  const endIdx = allLines.length - scrollOffset;
  const visibleLines = allLines.slice(startIdx, endIdx);

  // 1. Xóa sạch vùng cuộn (từ dòng 1 đến rows-2)
  for (let i = 1; i <= rows - 2; i++) {
    process.stdout.write(`\x1b[${i};1H\x1b[K`);
  }

  // 2. Vẽ các dòng văn bản hiển thị lên vùng cuộn
  visibleLines.forEach((line, idx) => {
    process.stdout.write(`\x1b[${idx + 1};1H${line}`);
  });

  // 3. Đặt con trỏ in ấn ở dòng rows-2 và lưu lại vị trí
  process.stdout.write(`\x1b[${rows - 2};1H\x1b[s`);
}

// Hàm in nội dung an toàn vào Vùng cuộn (Scroll Region)
function printInScrollRegion(text) {
  scrollContentBuffer += text;
  
  if (scrollOffset === 0) {
    refreshScrollRegion();
  }
  
  renderUICallback();
}

function consoleLog(text) {
  printInScrollRegion(text + '\n');
}

function consoleError(text) {
  printInScrollRegion(`\x1b[31m${text}\x1b[0m\n`);
}

// Khởi tạo Alternate Screen Buffer và Scrolling Region
function initTUI() {
  const rows = process.stdout.rows || 24;
  
  process.stdout.write('\x1b[?1049h'); // Bật Alternate Screen Buffer
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // Xóa sạch màn hình đệm
  process.stdout.write(`\x1b[1;${rows - 2}r`); // Khóa vùng cuộn
  process.stdout.write(`\x1b[${rows - 2};1H\x1b[s`); // Đặt và lưu con trỏ in ấn

  // Lắng nghe sự kiện Resize để co giãn vùng cuộn theo cửa sổ Terminal
  process.stdout.on('resize', () => {
    const r = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${r - 2}r`);
    refreshScrollRegion();
    renderUICallback();
  });
}

// Khôi phục terminal gốc (Normal Screen Buffer) khi thoát chương trình
async function shutdownTUI() {
  process.stdout.write('\x1b[r'); // Reset scrolling region
  process.stdout.write('\x1b[?1049l'); // Quay lại Normal Screen Buffer
  await driver.closeBrowser().catch(() => {});
  process.exit(0);
}

module.exports = {
  initTUI,
  shutdownTUI,
  printInScrollRegion,
  refreshScrollRegion,
  consoleLog,
  consoleError,
  setRenderUICallback,
  getScrollOffset: () => scrollOffset,
  setScrollOffset: (val) => { scrollOffset = val; },
  getScrollContentBuffer: () => scrollContentBuffer,
  setScrollContentBuffer: (val) => { scrollContentBuffer = val; }
};
