#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');

const token = process.env.QWEN_TOKEN;
if (!token) { console.error('❌ Không tìm thấy QWEN_TOKEN trong .env'); process.exit(1); }

console.log(`🔑 Token: ...${token.slice(-10)}`);
console.log('🌐 Đang fetch https://chat.qwen.ai/api/v2/models/ ...\n');

const options = {
  hostname: 'chat.qwen.ai',
  path: '/api/v2/models/',
  method: 'GET',
  headers: {
    'Cookie': `token=${token}`,
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://chat.qwen.ai/',
  }
};

const req = https.request(options, (res) => {
  console.log(`HTTP Status: ${res.statusCode}`);
  let raw = '';
  res.on('data', d => raw += d);
  res.on('end', () => {
    try {
      const json = JSON.parse(raw);
      const list = json.success && Array.isArray(json.data)
        ? json.data
        : Array.isArray(json) ? json : null;

      if (!list) {
        console.log('⚠️  Format lạ. Raw:');
        console.log(JSON.stringify(json, null, 2).slice(0, 1000));
        return;
      }

      console.log(`✅ Tổng số mô hình: ${list.length}\n`);
      list.forEach((m, i) => {
        const display = m.title || m.name || m.id || m.model || '';
        const value   = m.id   || m.model || '';
        console.log(`  ${String(i+1).padStart(2)}. ${display.padEnd(35)} → ${value}`);
      });

      console.log('\n📋 editorFormat (để kiểm tra):');
      const ef = list.filter(m => m && (m.id || m.model))
        .map(m => ({ display: m.title || m.name || m.id || m.model, value: m.id || m.model }));
      console.log(JSON.stringify(ef, null, 2));

    } catch (e) {
      console.error('❌ Parse lỗi:', e.message);
      console.log('Raw:', raw.slice(0, 500));
    }
  });
});
req.on('error', e => console.error('❌ Request lỗi:', e.message));
req.end();
