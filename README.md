# Qwen Chat CLI on Terminal

Ứng dụng dòng lệnh (CLI) mạnh mẽ, chuyên nghiệp kết nối trực tiếp với **Qwen Chat Web** (chat.qwen.ai), mang lại trải nghiệm tương tác với AI tốc độ cao ngay trên Terminal của bạn mà không cần mở trình duyệt.

Dự án được trang bị giao diện người dùng tương tác **TUI (Terminal User Interface)** với khả năng tự động gợi ý (Autocomplete) đường dẫn tệp tin và các luồng tự động hóa bypass WAF thông minh.

---

## 🚀 Hướng dẫn Cài đặt & Sử dụng toàn cục (Khuyên dùng)

Để cài đặt ứng dụng dòng lệnh toàn cục và sử dụng từ bất kỳ thư mục nào trên máy tính giống như Claude Code, bạn có thể chọn một trong hai cách:

### Cách 1: Sử dụng Script tải trực tiếp (Một dòng lệnh)
Nếu dự án đã được đẩy lên GitHub, bạn hoặc người sử dụng có thể mở terminal ở bất kỳ đâu và chạy lệnh sau để tải và tự động cài đặt:
```bash
curl -fsSL https://raw.githubusercontent.com/SonNX24042005/qwen-cli/main/install.sh | bash
```

### Cách 2: Cài đặt từ thư mục mã nguồn cục bộ
Nếu bạn đã clone sẵn dự án về máy:
1. Mở terminal tại thư mục dự án và chạy:
   ```bash
   npm install -g .
   ```
   *(CLI sẽ tự động cài đặt các dependencies và tải trình duyệt Chromium cho Playwright).*

2. **Khởi chạy ứng dụng**:
   Tại bất kỳ thư mục nào trên máy tính, chỉ cần mở terminal và chạy:
   ```bash
   qwen-cli
   ```

---

## 💻 Cách sử dụng cục bộ (Local Run)

Nếu bạn chỉ muốn chạy thử nghiệm trực tiếp tại thư mục dự án mà không cài đặt toàn cục:

1. **Cài đặt dependencies & browser**:
   ```bash
   npm install
   npx playwright install chromium
   ```
2. **Khởi chạy**:
   ```bash
   npm start
   ```

*   **Đăng nhập lần đầu**: Khi chạy lần đầu (cục bộ hoặc toàn cục): CLI sẽ tự động mở ra một cửa sổ Chrome hiển thị. Bạn chỉ cần đăng nhập tài khoản Qwen của mình. CLI sẽ lưu token vào file `.env` và tự động chuyển về chế độ Terminal.

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
7.  **Kiểm soát Tìm kiếm Web (`/ws` hoặc `/websearch`)**:
    *   Mặc định Tìm kiếm Web được **TẮT** để tối ưu hóa tài nguyên mạng.
    *   Gõ `/ws` hoặc `/websearch` và nhấn **Enter** để bật/tắt (toggle) Tìm kiếm Web.
    *   Gõ `/ws <câu_hỏi>` hoặc `/websearch <câu_hỏi>` để **bật** Tìm kiếm Web, sử dụng tính năng này cho câu hỏi đó và **ghi nhớ/giữ trạng thái bật** cho các câu hỏi tiếp theo.
8.  **Chế độ suy nghĩ linh hoạt (Thinking Mode)**:
    *   Tích hợp 3 chế độ suy nghĩ của Qwen: **Fast** (Trả lời nhanh không suy nghĩ), **Thinking** (Bắt buộc suy nghĩ sâu), **Auto** (Tự động).
    *   Gõ `/mode` hoặc `/md` để mở menu chọn chế độ, hoặc thay đổi trực tiếp bằng tham số khởi chạy CLI (`--mode`, `--think`, `-t`).
9.  **Hiển thị suy nghĩ chi tiết (Detailed Thinking)**:
    *   Bật/tắt hiển thị từng bước suy nghĩ chi tiết (như trên Web) bằng phím tắt **Ctrl+D** / **Ctrl+T** hoặc lệnh `/detail` / `/dt`.
    *   Trang bị hiệu ứng Spinner chuyển động động (`⠋`, `⠙`, `⠹`...) tránh cảm giác đứng màn hình khi AI đang suy luận.
10. **Phục hồi chat từ lịch sử (`/resume` hoặc `/rs`)**:
    *   Gõ `/resume` hoặc `/rs` hiển thị danh sách các cuộc hội thoại cũ từ tài khoản Qwen.
    *   Hỗ trợ phân trang: Chọn `❯ ⟳ Tải thêm cuộc hội thoại cũ hơn...` để nạp tiếp các trang cũ hơn trực tiếp trong menu.
    *   Khi chọn 1 cuộc hội thoại, CLI sẽ tự động tải, định dạng Markdown đầy đủ lịch sử chat cũ lên Terminal, đồng thời đồng bộ Chromium ngầm sang phòng chat đó để tiếp tục trò chuyện.
11. **Tối ưu hóa nhập liệu nâng cao**:
    *   Hỗ trợ phím **Home** / **End** để di chuyển nhanh con trỏ chuột về đầu hoặc cuối dòng.
    *   Tự động phát hiện và xuống dòng tự động (`Wrap`) khi nội dung nhập quá chiều ngang màn hình mà không làm đè lên thanh Status Bar.
12. **Khởi động ngầm, không chặn nhập liệu**:
    *   Trình duyệt Chromium được tự động khởi động ngầm ở chế độ background khi mở CLI.
    *   Người dùng có thể gõ phím, chuẩn bị sẵn câu hỏi, chọn mô hình hoặc các tính năng ngay lập tức mà không cần chờ kết nối hoàn tất.
13. **Tự động xuất đoạn chat (Auto Chat Export)**:
    *   Tự động lưu lịch sử hội thoại khi kết thúc phản hồi của AI (khi bật tính năng này bằng lệnh `/export` hoặc `/ep`).
    *   Hiển thị rõ ràng trạng thái hoạt động dưới dạng `💾 Xuất: BẬT/TẮT` trực tiếp trên thanh trạng thái (TUI Status Bar) ghim đáy terminal.
    *   Dữ liệu được lưu trong thư mục `output-qwen/` tại thư mục làm việc hiện tại dưới hai định dạng:
        *   `.json`: Chứa toàn bộ dữ liệu cấu trúc gốc từ Qwen Web API (phục vụ việc nạp ngược).
        *   `.md`: Định dạng Markdown dễ đọc, trình bày đẹp mắt các luồng suy nghĩ (Thinking Process) và tài liệu tham khảo tìm kiếm Web (Web Search References) trong các thẻ thu gọn `<details>`.
    *   Trạng thái Bật/Tắt được ghi nhớ độc lập cho từng phòng chat và tự động lưu vào tệp cấu hình `output-qwen/auto_export_sessions.json`.
14. **Nhập lịch sử trò chuyện (Import Chat History)**:
    *   Khôi phục cuộc trò chuyện cũ đã lưu từ file JSON hoặc Markdown bằng lệnh `/import <path>` hoặc `/ip <path>`.
    *   Hỗ trợ tự động phân tích cú pháp tiêu đề Markdown (`### 👤 User` và `### 🤖 Assistant`) để khôi phục tệp nếu không có file JSON đi kèm, tự động loại bỏ các thẻ `<details>` thừa để giữ ngữ cảnh sạch sẽ.
    *   Sau khi khôi phục, cuộc trò chuyện sẽ hiển thị đầy đủ trên Terminal và tự động nạp lịch sử tương ứng vào phiên chat mới của Qwen ngầm. Bạn có thể gửi tin nhắn tiếp theo và Qwen sẽ nhận biết toàn bộ bối cảnh cuộc trò chuyện cũ này.

---

## 💻 Cách sử dụng trong phiên Chat

### 1. Các câu lệnh điều khiển hệ thống (Gõ trực tiếp vào ô chat)
*   **Chọn mô hình chat (Model Selector)**:
    ```
    /m
    ```
    *(Hoặc `/model`, mở dropdown màu cam di chuyển bằng Mũi tên/TAB và nhấn Enter để chọn)*
*   **Chọn chế độ suy nghĩ (Thinking Mode)**:
    ```
    /md
    ```
    *(Hoặc `/mode`, mở dropdown chọn giữa: `Fast`, `Thinking`, `Auto`)*
    - Đổi nhanh qua tham số: `/md fast`, `/md thinking`, `/md auto`
*   **Bật/tắt suy nghĩ chi tiết (Detailed Thinking)**:
    ```
    /dt
    ```
    *(Hoặc `/detail`, hoặc dùng phím tắt nhanh **Ctrl+D** / **Ctrl+T** để bật/tắt hiển thị luồng suy nghĩ)*
*   **Tiếp tục chat từ lịch sử (Resume Chat)**:
    ```
    /rs
    ```
    *(Hoặc `/resume`, mở danh sách chọn các cuộc hội thoại cũ kèm nút `Tải thêm...` ở cuối)*
*   **Tìm kiếm Web (Web Search)**:
    - Bật/Tắt (Toggle):
      ```
      /ws
      ```
      *(Hoặc `/websearch`)*
    - Bật và hỏi trực tiếp:
      ```
      /ws <câu hỏi>
      ```
*   **Tạo cuộc trò chuyện mới (New Chat)**:
      ```
      /new
      ```
      *(Tạo phiên hội thoại trống hoàn toàn mới và giữ nguyên các thiết lập hiện tại)*
*   **Bật/tắt tự động xuất đoạn chat (Auto Export)**:
      ```
      /ep
      ```
      *(Hoặc `/export`, dùng để bật hoặc tắt chế độ tự động lưu lịch sử chat sang Markdown & JSON vào thư mục `output-qwen/`. Trạng thái bật/tắt sẽ hiển thị ở dòng `💾 Xuất: BẬT/TẮT` trên Status Bar đáy terminal).*
*   **Khôi phục cuộc trò chuyện từ file (Import Chat)**:
      ```
      /ip <đường_dẫn_file>
      ```
      *(Hoặc `/import <đường_dẫn_file>`, hỗ trợ nạp tệp `.json` hoặc `.md` đã lưu để tiếp tục trò chuyện)*
*   **Thoát ứng dụng**:
      ```
      /exit
      ```
      *(Hoặc nhấn tổ hợp phím `Ctrl + C`)*

### 2. Cờ tham số khởi chạy dòng lệnh (CLI Parameters)
Bạn có thể cấu hình trước các chế độ khi bắt đầu ứng dụng:
*   Chế độ mặc định: `node src/cli.js --mode fast` (hoặc `--think thinking`, `-t auto`)

### 3. Cú pháp đính kèm tệp tin & thư mục và gợi ý câu lệnh
Bạn chỉ cần gõ ký tự `@` rồi gõ tên file/folder, hoặc gõ `/` để gọi danh sách lệnh hệ thống (nhấn phím **TAB** để chọn nhanh):
*   **Gợi ý file tương tác**:
    > [You]: Giải thích logic trong file @src/ (nhấn TAB chọn file index.js) 
*   **Gợi ý câu lệnh hệ thống**:
    > [You]: / (nhấn TAB chọn lệnh như `/model`, `/websearch`, `/exit`)
*   **Quét và tải cả thư mục (Quét đệ quy)**:
    > [You]: Hãy rà soát toàn bộ mã nguồn trong folder @src và cho tôi biết có lỗ hổng bảo mật nào không.
*   **Tải lên nhiều tệp trùng tên ở các thư mục khác nhau**:
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