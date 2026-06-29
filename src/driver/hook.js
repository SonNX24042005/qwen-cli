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
