'use strict';

const screen = require('../tui/screen');
const driver = require('../driver');

// Phân tích cú pháp dữ liệu stream SSE
function parseSSEChunk(rawText, state, printCallback) {
  let { 
    currentResponseText, 
    hasShownThinkingLabel,
    hasShownAnswerLabel = false,
    aiResponseStartIndex = -1,
    webSearchInfo = [],
    printedThoughts = []
  } = state;

  const processJson = (dataJson) => {
    const parsed = JSON.parse(dataJson);
    
    if (parsed.web_search_info && Array.isArray(parsed.web_search_info)) {
      webSearchInfo = parsed.web_search_info;
    }

    const choices = parsed.choices;
    if (choices && choices[0]) {
      const delta = choices[0].delta;
      if (delta) {
        if (delta.extra && delta.extra.tool_result && delta.extra.tool_result.docs && Array.isArray(delta.extra.tool_result.docs)) {
          webSearchInfo = delta.extra.tool_result.docs;
        }

        // 1. Phát hiện phase suy nghĩ (thinking_summary)
        if (delta.phase === 'thinking_summary') {
          const isDetailed = driver.isDetailedThinking();
          if (!hasShownThinkingLabel) {
            if (isDetailed) {
              printCallback('\n[AI Thinking]:\n');
            } else {
              printCallback('\n[AI Thinking]: ');
            }
            screen.startThinkingSpinner();
            hasShownThinkingLabel = true;
          }

          if (isDetailed) {
            if (delta.extra) {
              const titles = delta.extra.summary_title ? delta.extra.summary_title.content : [];
              const thoughts = delta.extra.summary_thought ? delta.extra.summary_thought.content : [];
              
              for (let i = 0; i < titles.length; i++) {
                if (!printedThoughts[i]) {
                  printedThoughts[i] = { titlePrinted: false, contentPrintedLength: 0 };
                }
                
                const stepState = printedThoughts[i];
                if (!stepState.titlePrinted) {
                  const prefix = i === 0 ? '' : '\n';
                  printCallback(`${prefix}\x1b[1m\x1b[36m⚙ ${titles[i]}\x1b[0m\n`);
                  stepState.titlePrinted = true;
                }
                
                if (thoughts[i]) {
                  const fullThought = thoughts[i];
                  const printedLen = stepState.contentPrintedLength;
                  if (fullThought.length > printedLen) {
                    const newText = fullThought.slice(printedLen);
                    if (printedLen === 0) {
                      printCallback('  ');
                    }
                    const indentedText = newText.replace(/\n/g, '\n  ');
                    printCallback(`\x1b[90m${indentedText}\x1b[0m`);
                    stepState.contentPrintedLength = fullThought.length;
                  }
                }
              }
            }
          }
        }
        
        // 2. Phát hiện phase trả lời chính thức (answer)
        if (delta.content && (!delta.phase || delta.phase === 'answer')) {
          if (!hasShownAnswerLabel) {
            screen.stopThinkingSpinner();
            if (hasShownThinkingLabel || (driver.isDetailedThinking() && printedThoughts.length > 0)) {
              printCallback('\n\n\x1b[1m[AI]:\x1b[0m ');
            } else {
              printCallback('\n\x1b[1m[AI]:\x1b[0m ');
            }
            hasShownThinkingLabel = false;
            hasShownAnswerLabel = true;
            printedThoughts = [];
            aiResponseStartIndex = screen.getScrollContentBuffer().length;
          }

          const incomingText = delta.content;

          // Thuật toán so khớp thông minh: Tự động phát hiện Cumulative vs Incremental
          if (incomingText.startsWith(currentResponseText) && incomingText.length > currentResponseText.length) {
            const diffText = incomingText.slice(currentResponseText.length);
            printCallback(diffText);
            currentResponseText = incomingText;
          } else if (!incomingText.startsWith(currentResponseText)) {
            printCallback(incomingText);
            currentResponseText += incomingText;
          }
        }
      }
    }
  };

  // 1. Thử parse toàn bộ rawText dưới dạng một event JSON duy nhất (tránh lỗi ngắt dòng trong JSON)
  let trimmed = rawText.trim();
  if (trimmed.startsWith('data:')) {
    const dataJson = trimmed.slice(5).trim();
    if (dataJson && dataJson !== '[DONE]') {
      try {
        processJson(dataJson);
        return { currentResponseText, hasShownThinkingLabel, hasShownAnswerLabel, aiResponseStartIndex, webSearchInfo, printedThoughts };
      } catch (e) {
        // Fallback xuống giải pháp split dòng bên dưới nếu bị lỗi
      }
    }
  } else if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.success === false && parsed.data) {
        const errMsg = parsed.data.details || parsed.data.code || 'Lỗi không xác định';
        printCallback(`\n\x1b[31m[Lỗi Qwen]: ${errMsg}\x1b[0m\n`);
      }
      return { currentResponseText, hasShownThinkingLabel, hasShownAnswerLabel, aiResponseStartIndex, webSearchInfo, printedThoughts };
    } catch (e) {}
  }

  // 2. Giải pháp fallback: split theo dòng thô
  const lines = rawText.split('\n');
  for (const line of lines) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) continue;

    if (!lineTrimmed.startsWith('data:')) {
      if (lineTrimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(lineTrimmed);
          if (parsed.success === false && parsed.data) {
            const errMsg = parsed.data.details || parsed.data.code || 'Lỗi không xác định';
            printCallback(`\n\x1b[31m[Lỗi Qwen]: ${errMsg}\x1b[0m\n`);
          }
        } catch (e) {}
      }
      continue;
    }

    const dataJson = lineTrimmed.slice(5).trim();
    if (!dataJson || dataJson === '[DONE]') continue;

    try {
      processJson(dataJson);
    } catch (e) {
      // Bỏ qua lỗi parse JSON
    }
  }

  return { 
    currentResponseText, 
    hasShownThinkingLabel, 
    hasShownAnswerLabel, 
    aiResponseStartIndex,
    webSearchInfo,
    printedThoughts
  };
}

module.exports = {
  parseSSEChunk
};
