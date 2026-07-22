# CÀI ĐẶT QWEN CHAT CLI TOÀN CỤC TRÊN WINDOWS

Write-Host "===========================================" -ForegroundColor Blue
Write-Host "     CÀI ĐẶT QWEN CHAT CLI TOÀN CỤC         " -ForegroundColor Blue
Write-Host "===========================================" -ForegroundColor Blue

# 1. Kiểm tra Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[Lỗi] Node.js chưa được cài đặt trên hệ thống." -ForegroundColor Red
    Write-Host "Vui lòng tải và cài đặt Node.js từ https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 2. Kiểm tra npm
if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[Lỗi] npm (Node Package Manager) chưa được cài đặt." -ForegroundColor Red
    exit 1
}

$nodeVer = node -v
Write-Host "Phát hiện Node.js: $nodeVer" -ForegroundColor Green

# 3. Định nghĩa thư mục cài đặt
$installDir = "$env:USERPROFILE\.qwen-cli"
Write-Host "Thư mục cài đặt: $installDir" -ForegroundColor Yellow

$dataDir = "$env:USERPROFILE\.qwen-cli-data"

if (Test-Path $installDir) {
    Write-Host "Đang tự động sao lưu dữ liệu người dùng và dọn dẹp phiên bản cũ..."
    if (!(Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
    foreach ($file in @("credentials.json", "storage_state.json", ".env")) {
        $oldFile = Join-Path $installDir $file
        $newFile = Join-Path $dataDir $file
        if ((Test-Path $oldFile) -and !(Test-Path $newFile)) {
            Copy-Item $oldFile $newFile -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -Recurse -Force $installDir
}

# 4. Tải mã nguồn từ GitHub
$repoUrl = "https://github.com/SonNX24042005/qwen-cli.git"
Write-Host "Đang tải mã nguồn từ $repoUrl..." -ForegroundColor Blue

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[Lỗi] Git chưa được cài đặt. Không thể tải mã nguồn." -ForegroundColor Red
    Write-Host "Vui lòng cài đặt Git trước khi chạy cài đặt." -ForegroundColor Yellow
    exit 1
}

git clone --depth 1 $repoUrl $installDir

# 5. Cài đặt các thư viện
cd $installDir
Write-Host "Đang cài đặt các thư viện phụ thuộc..." -ForegroundColor Green

# Tự dọn dẹp postinstall trong package.json nếu có
$packageJsonPath = Join-Path $installDir "package.json"
if (Test-Path $packageJsonPath) {
    $pkgJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    if ($pkgJson.scripts.postinstall) {
        Write-Host "Đang dọn dẹp cấu hình postinstall cũ..."
        $pkgJson.scripts.PSObject.Properties.Remove("postinstall")
        $pkgJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonPath
    }
}

# Cài đặt dependencies cục bộ
npm install

# Cài đặt toàn cục
Write-Host "Đang liên kết câu lệnh qwen-cli toàn cục..." -ForegroundColor Green
npm install -g .

Write-Host "`n===========================================" -ForegroundColor Green
Write-Host "     CÀI ĐẶT HOÀN TẤT THÀNH CÔNG!          " -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host "Bây giờ bạn có thể mở một Terminal mới và chạy:"
Write-Host "👉  qwen-cli" -ForegroundColor Yellow
Write-Host "==========================================="
