# Qwen Chat CLI on Terminal

Ứng dụng dòng lệnh (CLI) mạnh mẽ, chuyên nghiệp kết nối trực tiếp với **Qwen Chat Web** (chat.qwen.ai), mang lại trải nghiệm tương tác với AI tốc độ cao ngay trên Terminal của bạn mà không cần mở trình duyệt.

Dự án được trang bị giao diện người dùng tương tác **TUI (Terminal User Interface)** với khả năng tự động gợi ý (Autocomplete) đường dẫn tệp tin và các luồng tự động hóa bypass WAF thông minh.

---

## ✨ Các tính năng nổi bật

1.  **Dropdown Autocomplete tương tác ( TAB Selection )**:
    *   Gõ ký tự `@` trên dòng prompt nhập liệu để mở dropdown gợi ý danh sách tệp tin/thư mục con.
    *   Gõ ký tự `/` trên dòng prompt nhập liệu để mở dropdown gợi ý danh sách các lệnh điều khiển hệ thống (`/model`, `/websearch`, `/exit`, v.v.).
    *   Sử dụng phím **TAB**, **Shift+TAB** hoặc **phím Mũi tên Lên/Xuống** để di chuyển lựa chọn (mục đang chọn hiển thị nổi bật trên nền cam).
    *   Nhấn **Enter** để chọn nhanh hoặc **ESC** để đóng menu gợi ý.
2.  **Đính kèm Tệp & Thư mục thông minh (`@path`)**:
    *   Gõ `@tên_tệp` hoặc `@tên_thư_mục` ngay trong câu chat (ví dụ: `Hãy sửa lỗi trong folder @src và file @package.json`).
    *   Đối với thư mục, CLI tự động quét đệ quy các tệp con bên trong. Loại bỏ các folder rác (`node_modules`, `.git`, `debug/`...) và chỉ tải lên các tệp văn bản hợp lệ.
3.  **Vượt giới hạn 5 file của Qwen (Automatic Chunking)**:
    *   Qwen giới hạn chỉ cho phép upload tối đa 5 file trong một tin nhắn. 
    *   Nếu bạn tải lên nhiều hơn 5 file (từ folder hoặc chọn riêng lẻ), CLI tự động chia nhỏ danh sách thành các nhóm nhỏ (tối đa 5 file/lượt), gửi ngầm lên trước để Qwen ghi nhớ, sau đó lượt cuối cùng gửi kèm câu hỏi chính thức của bạn.
4.  **Giải pháp chống trùng tên & Đọc cấu trúc cây thư mục**:
    *   CLI tự động chuẩn hóa tên tệp tạm bằng cách thay thế dấu gạch chéo phân tách thư mục thành dấu gạch ngang kép `--` (ví dụ: `src/driver/index.js` ➔ `src--driver--index.js`).
    *   Tự động chèn dòng chú thích đường dẫn thực tế ở dòng đầu tiên của file văn bản (ví dụ: `// [Đường dẫn dự án thực tế: src/driver/index.js]`), giúp AI hiểu rõ cấu trúc cây thư mục của dự án và không bị nhầm lẫn giữa các file trùng tên.
5.  **Nhận diện Kéo thả trực tiếp (Drag & Drop)**:
    *   Bạn chỉ cần kéo và thả bất kỳ file hoặc folder nào từ File Explorer trực tiếp vào cửa sổ Terminal. CLI sẽ tự động bắt lấy đường dẫn tuyệt đối, làm sạch các dấu nháy thừa, xác minh sự tồn tại của file và tự động chèn thêm ký tự `@` ở trước để đính kèm ngay lập tức mà không cần gõ phím!
6.  **Tự động bypass bảo mật & Giải Captcha tương tác**:
    *   **Interactive Login Mode**: Tự động mở cửa sổ trình duyệt Chromium hiển thị (Headful) cho bạn đăng nhập nếu Token hết hạn. Node.js sẽ tự động bắt Token mới lưu vào `.env` và đóng trình duyệt để chuyển về chế độ chạy ẩn danh (Headless).
    *   **Interactive Captcha Solver**: Tự động mở cửa sổ trình duyệt Chrome thật khi phát hiện Captcha bảo mật Alibaba WAF RGV587. Bạn chỉ cần kéo thanh slider captcha trên màn hình, CLI sẽ tự động tắt trình duyệt và gửi lại câu hỏi bị nghẽn trước đó.
6.  **Kiểm soát Tìm kiếm Web (`/ws` hoặc `/websearch`)**:
    *   Mặc định Tìm kiếm Web được **TẮT** để tối ưu hóa tài nguyên mạng.
    *   Gõ `/ws` hoặc `/websearch` trên CLI để bật/tắt Tìm kiếm Web thời gian thực bất cứ lúc nào.

---

## 🚀 Hướng dẫn Cài đặt

1.  **Cài đặt các gói phụ thuộc (Dependencies)**:
    Mở terminal tại thư mục dự án và chạy:
    ```bash
    npm install
    ```
2.  **Cài đặt trình duyệt Playwright Chromium**:
    ```bash
    npx playwright install chromium
    ```

---

## 💻 Cách sử dụng

### 1. Khởi chạy CLI
```bash
npm start
```
*   Nếu là lần đầu chạy: CLI sẽ mở ra một cửa sổ Chrome hiển thị. Bạn chỉ cần đăng nhập tài khoản Qwen của mình. CLI sẽ lưu token vào file `.env` và tự động tắt cửa sổ để bạn bắt đầu chat trên Terminal.

### 2. Các câu lệnh điều khiển hệ thống (Gõ trực tiếp vào ô chat)
*   **Chọn mô hình chat (Model Selector)**:
    ```
    /m
    ```
    *(Hoặc `/model`, mở ra menu dropdown màu cam để di chuyển TAB/Mũi tên và Enter để chọn model)*
*   **Bật/Tắt Tìm kiếm Web**:
    ```
    /ws
    ```
    *(Hoặc `/websearch`)*
*   **Thoát ứng dụng**:
    ```
    /exit
    ```
    *(Hoặc nhấn tổ hợp phím `Ctrl + C`)*

### 3. Cú pháp đính kèm tệp tin & thư mục và gợi ý câu lệnh
Bạn chỉ cần gõ ký tự `@` rồi gõ tên file/folder, hoặc gõ `/` để gọi danh sách lệnh hệ thống (nhấn phím **TAB** để chọn nhanh):
*   **Gợi ý file tương tác**:
    > [You]: Giải thích logic trong file @src/ (nhấn TAB chọn file index.js) 
*   **Gợi ý câu lệnh hệ thống**:
    > [You]: / (nhấn TAB chọn lệnh như `/model`, `/websearch`, `/exit`)
*   **Quét và tải cả thư mục (Quét đệ quy)**:
    > [You]: Hãy rà soát toàn bộ mã nguồn trong folder @src và cho tôi biết có lỗ hổng bảo mật nào không.
*   **Tải lên nhiều file trùng tên ở các thư mục khác nhau**:
    > [You]: So sánh nội dung hai tệp cấu hình @debug/test_x/conf.txt và @debug/test_y/conf.txt giúp tôi.

---

## 📂 Cấu trúc mã nguồn chính
*   `src/cli.js`: Entry-point sạch sẽ, điều phối kết nối TUI và gửi/nhận tin nhắn qua driver.
*   `src/tui/`: Thư mục chứa giao diện dòng lệnh tương tác (TUI):
    *   `screen.js`: Quản lý Alternate Screen Buffer (preserves terminal shell history), giới hạn vùng cuộn (Scrolling Region), và khôi phục terminal gốc khi thoát.
    *   `editor.js`: Quản lý ô nhập liệu ghim đáy, dropdown autocomplete di chuyển bằng TAB/Mũi tên, tự động bắt kéo thả file, và phím nóng PageUp/PageDown/Mũi tên để cuộn ngược lịch sử.
*   `src/utils/`: Thư mục chứa các hàm tiện ích:
    *   `file.js`: Hàm hỗ trợ quét thư mục đệ quy, trích xuất tệp đính kèm `@path`, và chia nhỏ nhóm file upload.
    *   `sse.js`: Phân tích cú pháp dữ liệu stream SSE thời gian thực.
*   `src/driver/`: Thư mục tương tác trình duyệt:
    *   `index.js`: Khởi tạo Chromium ẩn ngầm và upload tệp đính kèm.
    *   `auth.js`: Chức năng tự động lấy Token đăng nhập (Interactive Login) và giải Captcha tương tác (RGV587).
    *   `hook.js`: Tiêm script fetch hook can thiệp stream SSE và cấu hình Web Search.