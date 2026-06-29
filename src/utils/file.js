'use strict';

const fs = require('fs');
const path = require('path');

// Trích xuất danh sách file/folder bắt đầu bằng ký tự @ từ nội dung chat
function extractAttachedFiles(inputText) {
  const fileRegex = /@([^\s"'\(\)\[\]\{\}]+)/g;
  const matches = [];
  let match;
  
  while ((match = fileRegex.exec(inputText)) !== null) {
    let cleanPath = match[1];
    if (cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    matches.push(cleanPath);
  }
  
  return [...new Set(matches)];
}

// Quét đệ quy tất cả các file hợp lệ trong thư mục (loại trừ các thư mục rác)
function getFilesRecursively(dirPath) {
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      
      if (stat && stat.isDirectory()) {
        const baseName = path.basename(fullPath);
        if (['node_modules', '.git', 'debug', 'references'].includes(baseName)) return;
        results = results.concat(getFilesRecursively(fullPath));
      } else {
        const ext = path.extname(fullPath).toLowerCase();
        const validExts = [
          '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.html', 
          '.css', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'
        ];
        if (validExts.includes(ext)) {
          results.push(fullPath);
        }
      }
    });
  } catch (err) {
    // Bỏ qua hoặc báo lỗi nhẹ
  }
  return results;
}

// Hàm chia mảng thành các nhóm nhỏ (chunks)
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

module.exports = {
  extractAttachedFiles,
  getFilesRecursively,
  chunkArray
};
