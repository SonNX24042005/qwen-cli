# Checklist Tổng thể Dự án Qwen Chat Terminal CLI (Đầy đủ & Chi tiết)

Bảng checklist này đối chiếu toàn bộ các tính năng từ giao diện Qwen Chat Web (phân tích từ `analysis_results.md` và 20 screenshots) với trạng thái triển khai thực tế trên Terminal CLI.

---

## 1. Cơ chế Kết nối & Bảo mật (Bypass WAF / Captcha)
Cơ chế cốt lõi giúp CLI chạy ẩn danh ổn định và vượt qua tường lửa của Alibaba.

- [x] **Xác thực tự động (Authentication Bypass)**
  - [x] Tự động nạp cookie `token` vào context trình duyệt.
  - [x] Tự động nạp token xác thực vào `localStorage` (`token` và `active_token`).
- [x] **Tee Hook (Hooking window.fetch)**
  - [x] Hook request `POST /api/v2/chat/completions` để bypass cơ chế sinh chữ ký bảo mật `bx-ua`, `bx-umidtoken` của Alibaba WAF.
  - [x] Nhân bản stream SSE (`resp.body.tee()`) và giải mã dữ liệu thời gian thực.
  - [x] Đồng bộ hóa IPC binding đẩy dữ liệu về Node.js (`window.__qwenChunk`).
- [x] **Tự động lấy Token đăng nhập (Interactive Login Mode)**
  - [x] Tự động phát hiện token trống hoặc hết hạn (chuyển hướng sang Guest/Login Page).
  - [x] Tự động mở cửa sổ trình duyệt Chromium thật (Headful) để người dùng đăng nhập bằng tay.
  - [x] Tự động bắt lấy token đăng nhập thành công, ghi đè vào file `.env` và chuyển về chạy ngầm (Headless).
- [x] **Tự động giải Captcha (Interactive Captcha Solver)**
  - [x] Phát hiện lỗi bị chặn `RGV587` / Slider Captcha từ Alibaba WAF.
  - [x] Tự động mở trình duyệt thật tại vị trí bị chặn để người dùng kéo thanh trượt xác thực.
  - [x] Tự đóng trình duyệt khi giải xong, chuyển về chạy ngầm và **gửi lại câu hỏi bị lỗi trước đó** một cách tự động.
- [x] **Tối ưu hóa Tài nguyên CLI**
  - [x] Chạy Chromium ở chế độ ẩn ngầm (`headless: true`) để tiết kiệm RAM.
  - [x] Chặn tải các tài nguyên nặng (image, font, video) qua Playwright routing (`BLOCK_ASSETS`).

---

## 2. Giao diện Chat & Nhập liệu (Input Box & Message View)
Các tính năng điều khiển và định dạng nhập liệu.

- [ ] **Các công cụ đính kèm & Chuyên biệt (Menu nút "+")**
  - [x] **Upload attachment**: Upload file đính kèm (tài liệu, hình ảnh, video, âm thanh).
  - [x] **Folder Upload & Chunking**: Hỗ trợ đính kèm cả thư mục (quét đệ quy) và tự động chia nhóm 5 file/lượt upload để vượt qua giới hạn của Qwen.
  - [ ] **Deep Research**: Chế độ nghiên cứu chuyên sâu.
  - [x] **Web Search**: Tìm kiếm Web thời gian thực.
  - [ ] **Create Image**: Tạo ảnh từ văn bản.
  - [ ] **Create Video**: Tạo video.
  - [ ] **Web Dev**: Lập trình web có xem trước (preview).
  - [ ] **Slides**: Tạo bài thuyết trình PowerPoint/Slides.
  - [ ] **Artifacts**: Hiển thị mã nguồn/văn bản trực quan (tương tự Claude Artifacts).
  - [ ] **Learn**: Trợ lý học tập chuyên biệt.
  - [ ] **Travel Planner**: Lên kế hoạch du lịch.
- [/] **Nhập liệu & Gửi tin nhắn (Prompt Input)**
  - [x] Điền prompt vào `textarea` thông qua Playwright API chuẩn (`page.fill`) để kích hoạt state React.
  - [x] Nhấn Enter giả lập (`page.press`) để gửi tin nhắn đi.
  - [x] **Interactive TUI Prompt**: Ghim ô nhập liệu ghim đáy (`Bottom Pinned`) và thanh trạng thái (`Status Bar`) cố định ở dòng dưới cùng của Terminal, tự động co giãn kích thước và dọn dẹp sạch sẽ khi thoát.
  - [x] **Dropdown Autocomplete**: Gợi ý tệp/thư mục qua ký tự `@` hiển thị menu nổi bật nền cam di chuyển bằng TAB/Mũi tên và tự động dọn dẹp sạch sẽ khi chọn xong.
  - [x] **Drag & Drop Auto-detect**: Tự động nhận diện và chuyển đổi đường dẫn file/folder khi kéo thả hoặc paste trực tiếp vào Terminal sang dạng đính kèm `@path`.
  - [ ] Nhập liệu bằng giọng nói (Voice/Microphone Input).
- [x] **Hiển thị & Parse Stream (Stream Response)**
  - [x] Parse stream SSE và in trực tiếp ra console theo thời gian thực (real-time stream).
  - [x] Thuật toán so khớp chuỗi thông minh tự xử lý cả 2 định dạng Cumulative (tích lũy) và Incremental (tăng dần) mà không bị lặp chữ.
  - [x] Hiển thị quá trình suy nghĩ (Thinking process) dưới dạng kí hiệu dấu chấm loading `.` trước khi in câu trả lời chính thức.
- [ ] **Tương tác với câu trả lời (Message Actions)**
  - [ ] Sao chép câu trả lời (Copy Response).
  - [ ] Like / Dislike câu trả lời để đánh giá phản hồi.
  - [ ] Chia sẻ hội thoại (Share).
  - [ ] Tạo lại câu trả lời mới (Regenerate).
  - [ ] Xem chi tiết log suy nghĩ đầy đủ (Expand Thinking process).

---

## 3. Cấu hình Tham số Chat (Chat Settings & Parameters)
Các cấu hình điều khiển mô hình và phong cách phản hồi.

- [x] **Lựa chọn Mô hình (Model Selection)**
  - [x] Mặc định kết nối và sử dụng model **Qwen3.7-Plus** (Model đa phương thức và suy nghĩ sâu tốt nhất).
  - [x] Cho phép chuyển đổi nhanh model qua CLI parameter, lệnh gõ hoặc menu tương tác.
  - [ ] So sánh mô hình song song (Model Comparison).
- [x] **Chế độ Suy nghĩ (Thinking Mode)**
  - [x] Mặc định chạy ở chế độ **Auto** (Tự động quyết định suy nghĩ).
  - [x] Cho phép cấu hình cứng các chế độ qua CLI parameter: *Auto*, *Thinking* (Bắt buộc suy nghĩ sâu), *Fast* (Trả lời ngay không suy nghĩ).
- [x] **Tìm kiếm Web (Web Search)**
  - [x] Mặc định kích hoạt tìm kiếm Web (Auto Search).
  - [x] Cho phép bật/tắt Web Search bằng tham số CLI.

---

## 4. Quản lý Dự án (Project Management)
Các tính năng phân vùng làm việc độc lập.

- [ ] **Quản lý không gian dự án**
  - [ ] Tạo dự án mới thông qua CLI.
  - [ ] Chat trong dự án cụ thể (tự động đính kèm `project_id`).
  - [ ] Đổi tên, Nhân bản (Clone), Lưu trữ (Archive), Di chuyển (Move to/from project), Xóa dự án.
- [ ] **Cấu hình nâng cao cho dự án (Project Advanced Settings)**
  - [ ] Cấu hình Memory Mode: *Default* (Dùng chung bộ nhớ tài khoản) hoặc *Project-only* (Cô lập bộ nhớ trong dự án).
  - [ ] Hướng dẫn hệ thống riêng cho dự án (Project instructions).
  - [ ] Tải file tri thức dự án (Knowledge Files / Add Files).

---

## 5. Cá nhân hóa & Trí nhớ (Personalization & Memory)
Cấu hình hồ sơ và trí nhớ dài hạn của AI.

- [ ] **Customize Qwen (Custom Instructions)**
  - [ ] Thiết lập Biệt hiệu (Nickname) để AI gọi bạn.
  - [ ] Thiết lập Thông tin bản thân để AI tối ưu câu trả lời.
  - [ ] Chọn phong cách phản hồi (Response style): *Default*, *Concise* (Ngắn gọn), *Socratic*, *Formal* (Trang trọng).
  - [ ] Chỉ dẫn hệ thống chung (Custom instructions).
- [ ] **Quản lý Trí nhớ (Saved Memory)**
  - [ ] Xem danh sách các mục ký ức dài hạn được lưu (tối đa 50 mục).
  - [ ] Xóa hoặc chỉnh sửa các mục ký ức dài hạn.
  - [ ] Bật/tắt việc tham chiếu ký ức dài hạn (`Reference saved memories`).
  - [ ] Bật/tắt tham chiếu lịch sử chat ngoài phiên (`Reference the chat history`).

---

## 6. Cấu hình Hệ thống & Lịch sử (App Settings & History)
Các cài đặt ứng dụng và lịch sử hội thoại.

- [ ] **Cấu hình giao diện và âm thanh (General Settings)**
  - [ ] Thay đổi Theme (Dark/Light/System).
  - [ ] Chọn ngôn ngữ hiển thị.
  - [ ] Chọn giọng đọc Text-to-Speech (TTS) để AI đọc to câu trả lời.
- [ ] **Cài đặt Interface (Interface settings)**
  - [ ] Bật/tắt tự động tạo tiêu đề chat (Title Auto-Generation).
  - [ ] Bật/tắt tự động copy câu trả lời (Auto-Copy Response).
  - [ ] Bật/tắt tự động chuyển văn bản dài thành file (Paste Large Text as File).
- [ ] **Cài đặt Tài khoản (Account Settings)**
  - [ ] Đổi tên tài khoản hiển thị.
  - [ ] Đổi mật khẩu.
  - [ ] Xóa tài khoản vĩnh viễn.
  - [ ] Quản lý và tùy chỉnh Cookies quảng cáo/cookie cần thiết.
- [/] **Quản lý lịch sử Chat (Chats Management)**
  - [x] Hiển thị danh sách hội thoại cũ (Chat history list) qua lệnh `/resume` / `/rs`.
  - [x] Phục hồi và tiếp tục cuộc hội thoại cũ trực tiếp trên Terminal và đồng bộ hóa trình duyệt ngầm.
  - [ ] Đổi tên, xóa, ghim (Pin), nhân bản (Clone), chia sẻ, tải xuống (Download) cuộc hội thoại cũ.
  - [ ] Xuất/Nhập lịch sử chat (Export/Import Chats).
