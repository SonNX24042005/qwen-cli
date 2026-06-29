# Thư mục Mã nguồn chính (`src/`)

Thư mục này chứa toàn bộ mã nguồn logic chính của ứng dụng Qwen Chat CLI.

## Cấu trúc thư mục

```
src/
├── cli.js        # Điểm khởi chạy CLI, quản lý I/O Terminal và vòng lặp chat
├── driver/       # Logic điều khiển trình duyệt và bypass WAF (Chromium automation)
│   ├── index.js  # Entry-point chính của driver điều khiển Chromium
│   ├── auth.js   # Xử lý Interactive Login và kiểm tra Captcha RGV587
│   └── hook.js   # Kỹ thuật Fetch Hook can thiệp mạng để nhân bản stream SSE
├── tui/          # Giao diện người dùng trên Terminal (TUI)
│   ├── screen.js # Quản lý Alternate Screen Buffer, kích thước terminal và dọn dẹp khi thoát
│   └── editor.js # Quản lý ô nhập liệu ghim đáy, autocompletion qua `@`, kéo thả file
└── utils/        # Các hàm tiện ích bổ trợ
    ├── file.js   # Tiện ích file, tìm tệp đệ quy, upload chunking
    └── sse.js    # Tiện ích phân tích stream SSE (Cumulative & Incremental parsing)
```

## Các thành phần chính

*   **`cli.js`**: Chịu trách nhiệm tương tác trực tiếp với người dùng qua console. Nó sử dụng module `readline` để nhận input từ bàn phím, gửi sang driver, nhận stream chunks trả về và hiển thị mượt mà ra console bằng thuật toán loại bỏ lặp văn bản lũy tiến (Cumulative/Incremental parser).
*   **`driver/`**: Lớp tự động hóa trình duyệt điều khiển Playwright Chromium để tương tác ẩn ngầm với Qwen Chat Web, xử lý các thách thức bảo mật của Alibaba WAF (Captcha, Token xác thực).
*   **`tui/`**: Quản lý giao diện Terminal (TUI) để nâng cao trải nghiệm người dùng (Alternate Screen Buffer để không làm bẩn lịch sử Terminal, ô nhập liệu ghim đáy, dropdown autocomplete gợi ý file/thư mục khi gõ `@`, và hỗ trợ bắt sự kiện Drag & Drop file vào terminal).
*   **`utils/`**: Các module bổ trợ xử lý tệp tin (quét đệ quy thư mục, chia nhỏ file upload khi vượt giới hạn 5 file của Qwen) và bộ phân tích stream SSE thông minh hỗ trợ in các chunk gia tăng.

## Nguyên tắc phát triển (Rules)
*   **Tách biệt logic**: `cli.js` chỉ làm nhiệm vụ giao tiếp dòng lệnh và không được chứa bất kỳ mã nguồn nào liên quan đến Playwright/Chromium. Toàn bộ logic trình duyệt phải được đóng gói bên trong `driver/`.
*   **Modular**: Khi thêm tính năng mới liên quan đến trình duyệt (ví dụ: đổi model, đính kèm file), hãy viết các module nhỏ trong `driver/` và xuất ra ngoài thông qua `driver/index.js` thay vì viết dồn vào một file.
*   **Single Responsibility (SRP)**: Logic vẽ màn hình và nhận diện bàn phím (`src/tui/`) phải được cô lập hoàn toàn khỏi logic kết nối Chromium (`src/driver/`) và logic phân tích dữ liệu stream (`src/utils/`).

