# my fish 前置环境自检（Windows PowerShell 5.1+）
# 用法：powershell -ExecutionPolicy Bypass -File tools/check-env.ps1
# 只读检查，不修改任何文件；输出 PASS / WARN / FAIL 表格。

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rows = New-Object System.Collections.Generic.List[object]
function Add-Row($name, $status, $detail) {
  $rows.Add([pscustomobject]@{ 检查 = $name; 结果 = $status; 详情 = $detail })
}
function Test-Port($port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ok = $c.ConnectAsync('127.0.0.1', [int]$port).Wait(800)
    $c.Close()
    return $ok
  } catch { return $false }
}
function Find-CommandPath($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return ''
}

$homeDir = $env:USERPROFILE
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $homeDir '.dsh' }

# ── 系统 ─────────────────────────────────────────────
try {
  $os = Get-CimInstance Win32_OperatingSystem
  Add-Row '系统' 'PASS' "$($os.Caption) build $($os.BuildNumber) / $($env:PROCESSOR_ARCHITECTURE)"
} catch { Add-Row '系统' 'WARN' '无法读取系统信息' }

# ── DSH ──────────────────────────────────────────────
$dshProc = Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($dshProc) {
  $ver = (Get-Item $dshProc.Path).VersionInfo.FileVersion
  Add-Row 'DeepSeek Harness' 'PASS' "运行中 $ver"
} elseif (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe')) {
  Add-Row 'DeepSeek Harness' 'WARN' '已安装但未运行'
} else {
  Add-Row 'DeepSeek Harness' 'FAIL' '未安装（需要桌面版 ≥0.2.1）'
}
if (Test-Path $dshHome) { Add-Row 'DSH 数据目录' 'PASS' $dshHome } else { Add-Row 'DSH 数据目录' 'WARN' "不存在：$dshHome" }

# 插件是否装进 profile
$profileDir = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $dshHome 'profiles\desktop' }
$pluginDir = Join-Path $profileDir 'node_modules\my-fish'
if (Test-Path $pluginDir) {
  $pkg = Get-Content (Join-Path $pluginDir 'package.json') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue | ConvertFrom-Json
  Add-Row 'my fish 插件' 'PASS' "已安装 $($pkg.version) @ $pluginDir"
} else {
  Add-Row 'my fish 插件' 'WARN' "profile 中未找到：$pluginDir"
}

# ── Node ─────────────────────────────────────────────
$nodeExe = ''
$runtimeRoot = Join-Path $dshHome 'dsh-runtimes'
if (Test-Path $runtimeRoot) {
  $nodeExe = Get-ChildItem $runtimeRoot -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\dependencies\\node\\' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $nodeExe) { $nodeExe = Find-CommandPath 'node' }
if ($nodeExe) {
  $nodeVer = (& $nodeExe -v 2>$null)
  $major = [int](($nodeVer -replace 'v','') -split '\.')[0]
  if ($major -ge 22) { Add-Row 'Node.js' 'PASS' "$nodeVer @ $nodeExe" }
  else { Add-Row 'Node.js' 'FAIL' "$nodeVer（需要 ≥22.5.0）" }
} else {
  Add-Row 'Node.js' 'FAIL' '未找到 Node（DSH 应自带）'
}

# ── SnowLuma / QQ ────────────────────────────────────
$snowDir = $env:FUSION_SNOWLUMA_DIR
if (-not $snowDir) { $snowDir = Join-Path $homeDir 'SnowLuma' }
$snowWebPort = 5099
$snowWsPort = 3001
if (Test-Path $snowDir) {
  $snowVer = ''
  $snowPkg = Join-Path $snowDir 'package.json'
  if (Test-Path $snowPkg) { $snowVer = (Get-Content $snowPkg -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  Add-Row 'SnowLuma' 'PASS' "$snowVer @ $snowDir"
  $rt = Join-Path $snowDir 'config\runtime.json'
  if (Test-Path $rt) { try { $snowWebPort = [int](Get-Content $rt -Raw -Encoding UTF8 | ConvertFrom-Json).webuiPort } catch {} }
  $ob = Get-ChildItem (Join-Path $snowDir 'config') -Filter 'onebot_*.json' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ob) { try { $snowWsPort = [int](Get-Content $ob.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).networks.wsServers[0].port } catch {} }
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*SnowLuma*index.mjs*' }
  if ($running) { Add-Row 'SnowLuma 进程' 'PASS' '运行中' } else { Add-Row 'SnowLuma 进程' 'WARN' '未运行（QQ 不会连上）' }
  if (Test-Port $snowWsPort) { Add-Row "QQ WS($snowWsPort)" 'PASS' '可连接' } else { Add-Row "QQ WS($snowWsPort)" 'WARN' '端口未监听' }
  if (Test-Port $snowWebPort) { Add-Row "SnowLuma WebUI($snowWebPort)" 'PASS' '打开后可扫码登录' } else { Add-Row "SnowLuma WebUI($snowWebPort)" 'WARN' '端口未监听' }
} else {
  Add-Row 'SnowLuma' 'WARN' "未安装/路径不对（QQ 聊天不可用；可用 FUSION_SNOWLUMA_DIR 指定）"
}

# ── 浏览器 / 抖音 ────────────────────────────────────
$browsers = @(
  @{ Name = 'Edge'; Path = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' },
  @{ Name = 'Edge'; Path = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' },
  @{ Name = 'Chrome'; Path = 'C:\Program Files\Google\Chrome\Application\chrome.exe' },
  @{ Name = 'Chrome'; Path = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
)
$foundBrowser = $false
foreach ($b in $browsers) {
  if (Test-Path $b.Path) {
    $v = (Get-Item $b.Path).VersionInfo.FileVersion
    Add-Row "浏览器 $($b.Name)" 'PASS' "$v @ $($b.Path)"
    $foundBrowser = $true
  }
}
if (-not $foundBrowser) { Add-Row '浏览器' 'FAIL' '未找到 Edge/Chrome（抖音需要）' }
if (Test-Port 47890) { Add-Row '抖音浏览器端口(47890)' 'PASS' '正在监听' } else { Add-Row '抖音浏览器端口(47890)' 'WARN' '未打开（打开抖音登录窗口时才会监听）' }

# ── 语音 / ffmpeg / 可选 ─────────────────────────────
$shim = $env:FUSION_SHIM_DIR
if (-not $shim) { $shim = Join-Path $homeDir 'fish-tts-shim' }
if (Test-Path $shim) { Add-Row '语音桥目录' 'PASS' $shim } else { Add-Row '语音桥目录' 'WARN' "不存在：$shim（纯文字不受影响）" }
if (Test-Port 8766) { Add-Row '语音桥端口(8766)' 'PASS' '可连接' } else { Add-Row '语音桥端口(8766)' 'WARN' '未运行' }
$ff = Find-CommandPath 'ffmpeg'
if ($ff) { Add-Row 'ffmpeg' 'PASS' $ff } else { Add-Row 'ffmpeg' 'WARN' '未安装（B站/抖音抽帧不可用）' }
$patches = $env:FUSION_PATCHES_DIR
if (-not $patches) { $patches = Join-Path $homeDir 'fish-soul-patches' }
if (Test-Path $patches) { Add-Row '补丁目录' 'PASS' $patches } else { Add-Row '补丁目录' 'WARN' '不存在（可选）' }

# ── 数据 ─────────────────────────────────────────────
$fishDb = Join-Path $dshHome 'fish-soul\soul.db'
if (Test-Path $fishDb) {
  $mb = [math]::Round((Get-Item $fishDb).Length / 1MB, 2)
  Add-Row '鱼数据库' 'PASS' "soul.db $mb MB"
} else { Add-Row '鱼数据库' 'WARN' '还没创建（首次启动后生成）' }
$betaHome = if ($env:MY_FISH_BETA_HOME) { $env:MY_FISH_BETA_HOME } else { Join-Path $homeDir '.dsh-fish-beta' }
if (Test-Path $betaHome) { Add-Row '测试版数据目录' 'PASS' $betaHome } else { Add-Row '测试版数据目录' 'WARN' '不存在（未装 beta）' }

# ── 网络 ─────────────────────────────────────────────
foreach ($site in @('bilibili.com', 'www.douyin.com', 'github.com')) {
  $ok = Test-NetConnection $site -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($ok) { Add-Row "网络 $site" 'PASS' '可访问' }
  else { Add-Row "网络 $site" 'WARN' '不可访问（GitHub 只影响自动更新）' }
}

$rows | Format-Table -AutoSize
$fail = ($rows | Where-Object { $_.结果 -eq 'FAIL' }).Count
$warn = ($rows | Where-Object { $_.结果 -eq 'WARN' }).Count
""
if ($fail -gt 0) { Write-Host "结论：有 $fail 项 FAIL，请先解决（红色）" -ForegroundColor Red }
elseif ($warn -gt 0) { Write-Host "结论：核心可用，有 $warn 项 WARN（可选增强/未运行服务）" -ForegroundColor Yellow }
else { Write-Host '结论：环境完整' -ForegroundColor Green }
