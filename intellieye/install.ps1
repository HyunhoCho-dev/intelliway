# install.ps1 — IntelliEye One-Click Installer
# Made by Hyunho Cho
#
# Usage (run in PowerShell as Administrator):
#   iex (iwr -useb https://raw.githubusercontent.com/HyunhoCho-dev/intellieye/main/install.ps1).Content

$ErrorActionPreference = "Stop"

$REPO_RAW  = "https://raw.githubusercontent.com/HyunhoCho-dev/intellieye/main"
$INSTALL_DIR = Join-Path $env:USERPROFILE "intellieye"
$FILES = @(
    "intellieye.py",
    "screen_capture.py",
    "model.py",
    "controller.py",
    "requirements.txt"
)

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  IntelliEye - AI Screen Control Agent"   -ForegroundColor Cyan
Write-Host "  Made by Hyunho Cho"                     -ForegroundColor Cyan
Write-Host "  One-Click Installer"                    -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Check Python 3.10+
# ---------------------------------------------------------------------------
Write-Host "[1/4] Python 버전 확인 중..." -ForegroundColor Yellow

try {
    $pyVersion = & python --version 2>&1
} catch {
    Write-Host "[오류] Python을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "       Python 3.10 이상을 설치한 뒤 다시 시도하세요: https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

if ($pyVersion -match "Python (\d+)\.(\d+)") {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
        Write-Host "[오류] Python $major.$minor 감지됨. Python 3.10 이상이 필요합니다." -ForegroundColor Red
        exit 1
    }
    Write-Host "       $pyVersion 확인 완료" -ForegroundColor Green
} else {
    Write-Host "[경고] Python 버전을 파싱할 수 없습니다. 계속 진행합니다." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Create install directory and download source files
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[2/4] 소스 파일 다운로드 중 → $INSTALL_DIR" -ForegroundColor Yellow

if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR | Out-Null
}

foreach ($file in $FILES) {
    $url  = "$REPO_RAW/$file"
    $dest = Join-Path $INSTALL_DIR $file
    Write-Host "       다운로드: $file"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
        Write-Host "[오류] $file 다운로드 실패: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host "       다운로드 완료" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Install Python dependencies
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[3/4] Python 패키지 설치 중 (시간이 걸릴 수 있습니다)..." -ForegroundColor Yellow

$reqFile = Join-Path $INSTALL_DIR "requirements.txt"
try {
    & python -m pip install --upgrade pip --quiet
    & python -m pip install -r $reqFile
    Write-Host "       패키지 설치 완료" -ForegroundColor Green
} catch {
    Write-Host "[오류] 패키지 설치 실패: $_" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Create intellieye.ps1 launcher and add to PATH (user scope)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[4/4] 실행 래퍼 등록 중..." -ForegroundColor Yellow

$launcherDir  = Join-Path $env:USERPROFILE "bin"
$launcherPath = Join-Path $launcherDir "intellieye.ps1"

if (-not (Test-Path $launcherDir)) {
    New-Item -ItemType Directory -Path $launcherDir | Out-Null
}

$launcherContent = @"
# intellieye.ps1 — IntelliEye launcher
Set-Location "$INSTALL_DIR"
python intellieye.py @args
"@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8

# Add ~/bin to the user PATH if not already present
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$launcherDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$launcherDir;$userPath", "User")
    Write-Host "       $launcherDir 를 사용자 PATH에 추가했습니다" -ForegroundColor Green
    Write-Host "       (변경 사항을 적용하려면 PowerShell을 재시작하세요)" -ForegroundColor Yellow
} else {
    Write-Host "       PATH 이미 설정됨" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  IntelliEye 설치 완료!"                  -ForegroundColor Green
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""
Write-Host "실행 방법:"                               -ForegroundColor White
Write-Host "  1) 새 PowerShell 창을 열고 입력:"       -ForegroundColor White
Write-Host "       intellieye"                        -ForegroundColor Yellow
Write-Host "  2) 또는 직접 실행:"                     -ForegroundColor White
Write-Host "       python $INSTALL_DIR\intellieye.py" -ForegroundColor Yellow
Write-Host ""
Write-Host "처음 실행 시 Gemma 4 모델을 HuggingFace에서 다운로드합니다."  -ForegroundColor White
Write-Host "모델 크기: E4B ~4GB / E2B ~2GB (시간이 걸릴 수 있습니다)"     -ForegroundColor White
Write-Host ""
