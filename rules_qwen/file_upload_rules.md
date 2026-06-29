# Quy tắc Tải lên và Ánh xạ Tệp tin (File Upload & Mapping Rules)

Tài liệu này chứa các quy tắc thiết lập hệ thống đính kèm tệp tin/thư mục của ứng dụng Qwen Chat CLI. Khi các quy tắc này được cấu hình vào mục **Custom Instructions** hoặc **System Prompt** của Qwen Chat, mô hình AI sẽ hiểu rõ cơ chế của CLI để phản hồi một cách chính xác tuyệt đối.

---

## 1. Quy tắc Đổi tên Tệp tạm thời (Double-Dash Separator)
*   **Mô tả**: Khi người dùng đính kèm file hoặc quét thư mục con, CLI tự động đổi tên tệp tạm thời trước khi upload bằng cách thay thế các dấu gạch chéo phân cách thư mục (`/` hoặc `\`) thành **dấu gạch ngang kép `--`**.
*   **Ví dụ**:
    *   `src/driver/index.js` ➔ Tải lên với tên: `src--driver--index.js`
    *   `docs/checklist.md` ➔ Tải lên với tên: `docs--checklist.md`
    *   `debug/test_x/secret.txt` ➔ Tải lên với tên: `debug--test_x--secret.txt`
*   **Mục đích**:
    1.  Tránh tình trạng trùng lặp tên tệp khi tải lên (ví dụ: dự án có nhiều tệp `index.js` ở các thư mục con khác nhau, nếu tải lên cùng tên `index.js` sẽ bị Qwen ghi đè hoặc nhầm lẫn).
    2.  Phân biệt rõ ràng ký tự ngăn cách thư mục `--` với ký tự gạch dưới `_` của tên file gốc (ví dụ: `sub_folder/ten_file.js` ➔ `sub_folder--ten_file.js`).
*   **Yêu cầu đối với AI**: Khi người dùng hoặc AI cần tham chiếu đến nội dung của file, AI cần ngầm hiểu rằng tệp tin được lưu trong lịch sử hội thoại dưới tên tạm thời `path--to--file.ext` chính là tệp tin thực tế nằm ở đường dẫn `path/to/file.ext` trong dự án.

---

## 2. Quy tắc Tiêm Header Đường dẫn thực tế (Path Annotation Header)
*   **Mô tả**: Đối với các file dạng văn bản (text files) phổ biến, CLI tự động chèn thêm một dòng chú thích chỉ rõ đường dẫn thực tế của dự án ở ngay **dòng đầu tiên (Line 1)** của tệp tin trước khi tải lên.
*   **Định dạng chú thích**:
    *   Các file `.js`, `.jsx`, `.ts`, `.tsx`, `.css`:
        ```javascript
        // [Đường dẫn dự án thực tế: path/to/file.js]
        ```
    *   Các file `.html`, `.md`:
        ```html
        <!-- Đường dẫn dự án thực tế: path/to/file.md -->
        ```
    *   Các file `.json`, `.yaml`, `.yml`, `.txt`:
        ```yaml
        # Đường dẫn dự án thực tế: path/to/file.json
        ```
*   **Yêu cầu đối với AI**: AI cần luôn luôn đọc dòng đầu tiên của các tệp đính kèm văn bản để biết chính xác vị trí của tệp tin đó trong cây thư mục của dự án. Khi đưa ra hướng dẫn sửa lỗi hoặc viết code mới, AI phải chỉ định đường dẫn thực tế này thay vì tên tệp tạm thời.

---

## 3. Quy tắc Viết lại Prompt (Prompt Rewrite Annotation)
*   **Mô tả**: Khi người dùng đính kèm file bằng cú pháp `@path` trong prompt chat, CLI tự động viết lại prompt để bổ sung chú thích ánh xạ tệp đã tải lên.
*   **Định dạng viết lại**:
    *   Đính kèm file đơn lẻ: 
        Thay thế `@path` thành `@path (được tải lên với tên: safeName)`.
        *Ví dụ*: `@src/driver/index.js` ➔ `@src/driver/index.js (được tải lên với tên: src--driver--index.js)`
    *   Đính kèm cả thư mục (Folder Upload):
        Thay thế `@folder` thành `@folder (thư mục chứa các tệp đã tải lên: safeName1, safeName2...)`.
        *Ví dụ*: `@src` ➔ `@src (thư mục chứa các tệp đã tải lên: src--cli.js, src--driver--index.js, src--driver--auth.js...)`
*   **Yêu cầu đối với AI**: AI sử dụng thông tin chú thích trong dấu ngoặc đơn này để nhanh chóng xác định và đối chiếu câu hỏi của người dùng với đúng tệp đính kèm tương ứng trong lịch sử chat.
