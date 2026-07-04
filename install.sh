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

# Chạy cài đặt toàn cục
if [ "$EUID" -ne 0 ]; then
    # Nếu không phải root, thử cài đặt trực tiếp, nếu lỗi quyền thì thử sudo
    npm install -g . || {
        echo -e "${YELLOW}Không đủ quyền ghi. Đang thử cài đặt với sudo...${NC}"
        sudo npm install -g . --unsafe-perm
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
