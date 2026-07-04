#!/bin/bash
set -e

# Màu sắc hiển thị
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}     CÀI ĐẶT QWEN CHAT CLI TOÀN CỤC         ${NC}"
echo -e "${BLUE}===========================================${NC}"

# 1. Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[Lỗi] Node.js chưa được cài đặt trên hệ thống.${NC}"
    echo -e "${YELLOW}Vui lòng tải và cài đặt Node.js (khuyên dùng bản LTS) từ https://nodejs.org/${NC}"
    exit 1
fi

# 2. Kiểm tra npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[Lỗi] npm (Node Package Manager) chưa được cài đặt.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "Phát hiện Node.js: ${GREEN}${NODE_VERSION}${NC}"

# 3. Tạo thư mục lưu trữ mã nguồn trong thư mục Home
INSTALL_DIR="$HOME/.qwen-cli"
echo -e "Thư mục cài đặt: ${YELLOW}${INSTALL_DIR}${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "Đang dọn dẹp thư mục cũ..."
    rm -rf "$INSTALL_DIR"
fi

# 4. Clone mã nguồn từ GitHub
# Lưu ý: Bạn có thể thay đổi URL nếu chuyển repo sang tài khoản khác
REPO_URL="https://github.com/SonNX24042005/qwen-cli.git"
echo -e "Đang tải mã nguồn từ ${BLUE}${REPO_URL}${NC}..."

if ! command -v git &> /dev/null; then
    echo -e "${RED}[Lỗi] Git chưa được cài đặt. Không thể tải mã nguồn.${NC}"
    echo -e "${YELLOW}Vui lòng cài đặt git trước (ví dụ: sudo apt install git trên Ubuntu/Debian).${NC}"
    exit 1
fi

git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"

# 5. Cài đặt các gói npm toàn cục
echo -e "Đang cài đặt thư viện npm và Chromium browser cho Playwright..."
cd "$INSTALL_DIR"

# Xóa postinstall script tạm thời nếu có để tránh lỗi trong quá trình npm install
if grep -q "postinstall" package.json; then
    echo -e "Đang tự động dọn dẹp cấu hình postinstall trong package.json..."
    node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); delete p.scripts.postinstall; fs.writeFileSync('package.json', JSON.stringify(p, null, 2), 'utf8');"
fi

# Chạy cài đặt toàn cục
if [ "$EUID" -ne 0 ]; then
    # Nếu không phải root, thử cài đặt trực tiếp, nếu lỗi quyền thì thử sudo
    npm install -g . || {
        echo -e "${YELLOW}Không đủ quyền ghi. Đang thử cài đặt với sudo...${NC}"
        if command -v sudo &> /dev/null; then
            # Kiểm tra xem sudo có gọi được npm không
            if sudo env "PATH=$PATH" command -v npm &> /dev/null; then
                sudo env "PATH=$PATH" npm install -g . --unsafe-perm
            elif sudo command -v npm &> /dev/null; then
                sudo npm install -g . --unsafe-perm
            else
                echo -e "${RED}[Lỗi] Không tìm thấy lệnh 'npm' khi chạy dưới quyền sudo (thường gặp khi dùng NVM).${NC}"
                echo -e "${YELLOW}Gợi ý: Hãy cấu hình npm global prefix để cài đặt không cần quyền root (sudo):${NC}"
                echo -e "  1. Tạo thư mục global:${BLUE} mkdir -p ~/.npm-global${NC}"
                echo -e "  2. Cấu hình prefix:${BLUE} npm config set prefix '~/.npm-global'${NC}"
                echo -e "  3. Thêm dòng sau vào cuối file ~/.bashrc hoặc ~/.zshrc:${BLUE} export PATH=\$PATH:~/.npm-global/bin${NC}"
                echo -e "  4. Mở terminal mới và chạy lại lệnh cài đặt."
                exit 1
            fi
        else
            echo -e "${RED}[Lỗi] Không đủ quyền ghi và không tìm thấy lệnh sudo.${NC}"
            exit 1
        fi
    }
else
    npm install -g . --unsafe-perm
fi

echo -e "\n${GREEN}===========================================${NC}"
echo -e "${GREEN}     CÀI ĐẶT HOÀN TẤT THÀNH CÔNG!          ${NC}"
echo -e "${GREEN}===========================================${NC}"
echo -e "Bây giờ bạn có thể mở một Terminal mới và chạy:"
echo -e "👉  ${YELLOW}qwen-cli${NC}"
echo -e "==========================================="
