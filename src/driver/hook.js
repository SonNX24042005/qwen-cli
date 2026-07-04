'use strict';

// Script hook fetch chèn vào trình duyệt
const INIT_SCRIPT = (token) => `(function() {
  try {
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('active_token', ${JSON.stringify(token)});
  } catch (e) {
    console.error('Lỗi set localStorage token:', e);
  }

  // Mặc định ban đầu TẮT Web Search và chọn model qwen3.7-plus
  if (window.__qwenWebSearchEnabled === undefined) {
    window.__qwenWebSearchEnabled = false;
  }
  if (window.__qwenModelName === undefined) {
    window.__qwenModelName = 'qwen3.7-plus';
  }
  if (window.__qwenThinkingMode === undefined) {
    window.__qwenThinkingMode = 'auto';
  }
  if (window.__qwenImportedHistory === undefined) {
    window.__qwenImportedHistory = null;
  }

  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  if (window.__teeInstalled) return;
  window.__teeInstalled = true;

  const originalFetch = window.fetch;
  window.fetch = function() {
    const resource = arguments[0];
    const url = (typeof resource === 'string') ? resource : (resource && resource.url) || '';

    // Can thiệp và thay đổi Payload gửi đi nếu là request chat completions
    if (url.indexOf('/api/v2/chat/completions') >= 0 && arguments[1] && arguments[1].body) {
      try {
        const bodyObj = JSON.parse(arguments[1].body);
        if (bodyObj) {
          // Ghi đè model name theo cấu hình từ CLI
          if (window.__qwenModelName) {
            bodyObj.model = window.__qwenModelName;
          }
          if (bodyObj.messages) {
            // Nhúng lịch sử trò chuyện đã import nếu có
            if (window.__qwenImportedHistory && Array.isArray(window.__qwenImportedHistory) && window.__qwenImportedHistory.length > 0) {
              const importedMessages = [];
              let prevFid = null;
              const currentModel = bodyObj.model || 'qwen3.7-plus';

              for (let i = 0; i < window.__qwenImportedHistory.length; i++) {
                const hMsg = window.__qwenImportedHistory[i];
                const fid = uuidv4();
                const mObj = {
                  fid: fid,
                  parentId: prevFid,
                  childrenIds: [],
                  role: hMsg.role,
                  content: hMsg.content || '',
                  user_action: 'chat',
                  files: [],
                  timestamp: Math.floor(Date.now() / 1000) - (window.__qwenImportedHistory.length - i),
                  models: [currentModel],
                  chat_type: 't2t',
                  sub_chat_type: 't2t',
                  feature_config: {
                    thinking_enabled: true,
                    output_schema: 'phase',
                    research_mode: 'normal',
                    auto_thinking: false,
                    thinking_mode: 'Thinking',
                    thinking_format: 'summary',
                    auto_search: false
                  },
                  extra: {
                    meta: {
                      subChatType: 't2t'
                    }
                  }
                };

                if (prevFid && importedMessages.length > 0) {
                  importedMessages[importedMessages.length - 1].childrenIds = [fid];
                }
                importedMessages.push(mObj);
                prevFid = fid;
              }

              if (bodyObj.messages.length > 0) {
                const currentMsg = bodyObj.messages[0];
                if (!currentMsg.fid) {
                  currentMsg.fid = uuidv4();
                }
                currentMsg.parentId = prevFid;
                if (importedMessages.length > 0) {
                  importedMessages[importedMessages.length - 1].childrenIds = [currentMsg.fid];
                }
                bodyObj.messages = importedMessages.concat(bodyObj.messages);
              } else {
                bodyObj.messages = importedMessages;
              }

              bodyObj.parent_id = prevFid;
              window.__qwenImportedHistory = null;
            }
            bodyObj.messages.forEach(msg => {
              if (msg.role === 'user') {
                if (!msg.feature_config) msg.feature_config = {};
                // Ghi đè cấu hình tìm kiếm web theo cài đặt từ CLI
                msg.feature_config.auto_search = !!window.__qwenWebSearchEnabled;
                
                // Ghi đè cấu hình chế độ suy nghĩ (thinking mode)
                const thinkingMode = window.__qwenThinkingMode || 'auto';
                if (thinkingMode === 'fast') {
                  msg.feature_config.thinking_enabled = false;
                  msg.feature_config.auto_thinking = false;
                  msg.feature_config.thinking_mode = 'Fast';
                } else if (thinkingMode === 'thinking') {
                  msg.feature_config.thinking_enabled = true;
                  msg.feature_config.auto_thinking = false;
                  msg.feature_config.thinking_mode = 'Thinking';
                } else { // auto
                  msg.feature_config.thinking_enabled = true;
                  msg.feature_config.auto_thinking = true;
                  msg.feature_config.thinking_mode = 'Thinking';
                }
                msg.feature_config.thinking_format = 'summary';
              }
            });
          }
          arguments[1].body = JSON.stringify(bodyObj);
        }
      } catch (err) {
        console.error('[Browser Hook] Lỗi can thiệp request body:', err);
      }
    }

    const promise = originalFetch.apply(this, arguments);

    if (url.indexOf('/api/v2/chat/completions') >= 0) {
      return promise.then(function(response) {
        try {
          if (response.body && typeof response.body.tee === 'function') {
            const streams = response.body.tee();
            const reader = streams[1].getReader();
            const decoder = new TextDecoder();

            (async function() {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  const chunkStr = decoder.decode(value, { stream: true });
                  if (window.__qwenChunk) {
                    window.__qwenChunk(encodeURIComponent(chunkStr));
                  }
                }
              } catch (err) {
                if (window.__qwenErr) window.__qwenErr(err.message || String(err));
              } finally {
                if (window.__qwenDone) window.__qwenDone();
              }
            })();

            return new Response(streams[0], {
              headers: response.headers,
              status: response.status,
              statusText: response.statusText
            });
          }
        } catch (e) {
          if (window.__qwenErr) window.__qwenErr('tee error: ' + e.message);
        }
        return response;
      });
    }

    return promise;
  };
})()`;

module.exports = {
  INIT_SCRIPT
};
