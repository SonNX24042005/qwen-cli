'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fileUtils = require('../src/utils/file');
const sseUtils = require('../src/utils/sse');
const markdownUtils = require('../src/utils/markdown');
const exportImportService = require('../src/services/exportImport');

test('extractAttachedFiles extracts @paths correctly', () => {
  const text = 'Check out @src/cli.js and @docs/readme.md, also @package.json/';
  const files = fileUtils.extractAttachedFiles(text);
  assert.deepEqual(files, ['src/cli.js', 'docs/readme.md', 'package.json']);
});

test('chunkArray splits arrays correctly', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const chunks = fileUtils.chunkArray(arr, 5);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0], [1, 2, 3, 4, 5]);
  assert.deepEqual(chunks[1], [6, 7, 8, 9, 10]);
  assert.deepEqual(chunks[2], [11]);
});

test('replaceCitations formats URLs and citation indices', () => {
  const text = 'Here is info [1] and raw link https://example.com/test.';
  const docs = [{ url: 'https://qwen.ai/doc1' }];
  const result = markdownUtils.replaceCitations(text, docs);
  assert.ok(result.includes('[[1]](https://qwen.ai/doc1)'));
  assert.ok(result.includes('[example.com](https://example.com/test)'));
});

test('parseSSEChunk parses SSE stream correctly', () => {
  let printedText = '';
  const printCb = (txt) => { printedText += txt; };
  
  let state = {
    currentResponseText: '',
    hasShownThinkingLabel: false,
    hasShownAnswerLabel: false,
    aiResponseStartIndex: -1,
    webSearchInfo: [],
    printedThoughts: []
  };

  const rawChunk = 'data: {"choices":[{"delta":{"phase":"answer","content":"Xin chào!"}}]}';
  const newState = sseUtils.parseSSEChunk(rawChunk, state, printCb);
  
  assert.equal(newState.currentResponseText, 'Xin chào!');
  assert.ok(printedText.includes('Xin chào!'));
});

test('convertChatToMarkdown and parseMarkdownToMessages roundtrip', () => {
  const mockChatData = {
    id: 'test-id-123',
    title: 'Test Conversation',
    models: ['qwen3.7-plus'],
    created_at: 1700000000,
    chat: {
      messages: {
        'msg1': { role: 'user', content: 'Hello AI', timestamp: 1 },
        'msg2': { role: 'assistant', content: 'Hello User!', timestamp: 2 }
      }
    }
  };

  const md = exportImportService.convertChatToMarkdown(mockChatData);
  assert.ok(md.includes('# Test Conversation'));
  assert.ok(md.includes('### 👤 User'));
  assert.ok(md.includes('Hello AI'));
  assert.ok(md.includes('### 🤖 Assistant'));
  assert.ok(md.includes('Hello User!'));

  const parsedMsgs = exportImportService.parseMarkdownToMessages(md);
  assert.equal(parsedMsgs.length, 2);
  assert.equal(parsedMsgs[0].role, 'user');
  assert.equal(parsedMsgs[0].content, 'Hello AI');
  assert.equal(parsedMsgs[1].role, 'assistant');
  assert.equal(parsedMsgs[1].content, 'Hello User!');
});
