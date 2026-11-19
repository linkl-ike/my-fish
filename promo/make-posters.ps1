Add-Type -AssemblyName System.Drawing

$shots = Join-Path $env:TEMP 'myfish-shots'
$outDir = 'C:\Users\MSI-\dsh-plugins\my-fish\promo'
$W = 1080; $H = 1440
$fontName = 'Microsoft YaHei'

function C([int]$r,[int]$g,[int]$b,[int]$a=255) { return [System.Drawing.Color]::FromArgb($a,$r,$g,$b) }
function F([float]$size,[string]$style='Regular') {
  $fs = [System.Drawing.FontStyle]::$style
  return New-Object System.Drawing.Font($fontName, $size, $fs, [System.Drawing.GraphicsUnit]::Pixel)
}
function RoundPath([float]$x,[float]$y,[float]$w,[float]$h,[float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r*2, $r*2, 180, 90)
  $p.AddArc($x+$w-$r*2, $y, $r*2, $r*2, 270, 90)
  $p.AddArc($x+$w-$r*2, $y+$h-$r*2, $r*2, $r*2, 0, 90)
  $p.AddArc($x, $y+$h-$r*2, $r*2, $r*2, 90, 90)
  $p.CloseFigure()
  return $p
}
function Txt($g, [string]$text, [float]$x, [float]$y, $font, $color) {
  $b = New-Object System.Drawing.SolidBrush $color
  $g.DrawString($text, $font, $b, $x, $y)
  $b.Dispose()
}
function Chip($g, [string]$text, [float]$x, [float]$y, $font, $fill, $fg, $border) {
  $sz = $g.MeasureString($text, $font)
  $w = [float]($sz.Width + 34); $h = [float]($sz.Height + 16)
  $path = RoundPath $x $y $w $h 16
  $b = New-Object System.Drawing.SolidBrush $fill
  $g.FillPath($b, $path)
  $pen = New-Object System.Drawing.Pen $border, 1.5
  $g.DrawPath($pen, $path)
  $b.Dispose(); $pen.Dispose(); $path.Dispose()
  Txt $g $text ($x+17) ($y+7) $font $fg
  return $w
}
function Mosaic-Area($bmp, [int]$x, [int]$y, [int]$w, [int]$h) {
  if ($w -lt 8 -or $h -lt 8) { return }
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $path = RoundPath ([float]$x) ([float]$y) ([float]$w) ([float]$h) 6
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 230, 233, 240))
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose(); $g.Dispose()
}
function Mask-Shot([string]$name) {
  $src = Join-Path $shots $name
  $maskedDir = Join-Path $shots 'masked'
  New-Item -ItemType Directory -Force $maskedDir | Out-Null
  $bmp = [System.Drawing.Bitmap]::FromFile($src)
  $bmp.SetResolution(96, 96)
  switch ($name) {
    'shot-panel.png' {
      Mosaic-Area $bmp 805 696 210 44
    }
    'shot-channels.png' {
      Mosaic-Area $bmp 875 420 165 50
      Mosaic-Area $bmp 835 520 185 50
      Mosaic-Area $bmp 1370 474 110 52
      Mosaic-Area $bmp 755 974 205 52
      Mosaic-Area $bmp 1365 974 100 52
    }
    'shot-memory.png' {
      Mosaic-Area $bmp 480 700 165 32
      Mosaic-Area $bmp 420 742 400 34
      Mosaic-Area $bmp 480 872 165 32
      Mosaic-Area $bmp 420 912 470 34
      Mosaic-Area $bmp 420 1082 1500 112
    }
    'shot-service.png' {
      Mosaic-Area $bmp 1030 928 195 40
    }
  }
  $bmp.Save((Join-Path $maskedDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
function MaskBox($g, [int]$x, [int]$y, [int]$w, [int]$h) {
  if ($w -lt 8 -or $h -lt 8) { return }
  $path = RoundPath ([float]$x) ([float]$y) ([float]$w) ([float]$h) 6
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 228, 231, 238))
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}
function CropShot([string]$file) {
  $leaf = Split-Path $file -Leaf
  $img = [System.Drawing.Image]::FromFile((Join-Path $shots $leaf))
  $rect = New-Object System.Drawing.Rectangle 396, 90, 1512, 1134
  $crop = New-Object System.Drawing.Bitmap 1512, 1134
  $cg = [System.Drawing.Graphics]::FromImage($crop)
  $cg.DrawImage($img, (New-Object System.Drawing.Rectangle 0,0,1512,1134), $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $cg.Dispose(); $img.Dispose()
  # 在裁剪后的位图上做隐私遮挡：crop 坐标 = 原图坐标 - (396, 90)
  $mg = [System.Drawing.Graphics]::FromImage($crop)
  $mg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $mg.Dispose()
  return $crop
}
function DrawShotCard($g, [string]$file, [float]$x, [float]$y, [float]$w, [float]$h) {
  $sp = RoundPath ($x+6) ($y+16) $w $h 24
  $sb = New-Object System.Drawing.SolidBrush (C 0 0 0 90)
  $g.FillPath($sb, $sp)
  $sb.Dispose(); $sp.Dispose()
  $cp = RoundPath $x $y $w $h 24
  $cb = New-Object System.Drawing.SolidBrush (C 255 255 255)
  $g.FillPath($cb, $cp)
  $cb.Dispose()
  $pen = New-Object System.Drawing.Pen (C 56 189 248 200), 2
  $g.DrawPath($pen, $cp)
  $pen.Dispose()
  $shot = CropShot $file
  $state = $g.Save()
  $g.SetClip($cp)
  $g.DrawImage($shot, [int]$x, [int]$y, [int]$w, [int]$h)
  $g.Restore($state)
  $shot.Dispose(); $cp.Dispose()
}
function DrawMask($g, [int]$x, [int]$y, [int]$w, [int]$h) {
  $path = RoundPath ([float]$x) ([float]$y) ([float]$w) ([float]$h) 7
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 228, 231, 238))
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}
function New-Poster($title, $subtitle, $shot, $bullets, $page, $file, $footer) {
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rect = New-Object System.Drawing.Rectangle 0,0,$W,$H
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (C 8 12 24), (C 21 29 50), 60
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()
  $glow = New-Object System.Drawing.SolidBrush (C 56 189 248 30)
  $g.FillEllipse($glow, -280, -260, 980, 980)
  $glow.Dispose()
  $glow2 = New-Object System.Drawing.SolidBrush (C 139 92 246 26)
  $g.FillEllipse($glow2, 520, 1020, 980, 980)
  $glow2.Dispose()
  $badgeFont = F 24 'Bold'
  $w1 = Chip $g 'MY FISH' 72 78 $badgeFont (C 56 189 248 34) (C 125 211 252) (C 56 189 248 130)
  Txt $g 'DeepSeek Harness 插件' (72 + $w1 + 14) 84 (F 22) (C 148 163 184)
  $titleFont = F 74 'Bold'
  Txt $g $title 70 150 $titleFont (C 248 250 252)
  Txt $g $subtitle 74 252 (F 30) (C 148 197 253)
  DrawShotCard $g $shot 60 330 960 720
  $by = 1105
  $bulletFont = F 27
  foreach ($line in $bullets) {
    $dot = New-Object System.Drawing.SolidBrush (C 56 189 248)
    $g.FillEllipse($dot, 76, ($by + 10), 10, 10)
    $dot.Dispose()
    Txt $g $line 100 $by $bulletFont (C 226 232 240)
    $by += 48
  }
  Txt $g $footer 72 1358 (F 22) (C 100 116 139)
  $pn = "$page"
  $pw = $g.MeasureString($pn, (F 24 'Bold')).Width
  Txt $g $pn (1010 - $pw) 1356 (F 24 'Bold') (C 125 211 252)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $g.Dispose()
  Write-Output "saved $file"
}

# 隐私遮挡在 CropShot 里做（按文件名叠加遮罩块）

$coverBullets = @('18 个标签页：记忆 / 人格 / 心情 / 语音 / 通道 / 归档', '会认人：QQ、B站、抖音 认成同一个人', '会淡忘、会写日记、会刷视频、会自己发动态')
New-Poster 'my fish' '一只养在 DeepSeek Harness 里的 AI 鱼' (Join-Path $shots 'shot-panel.png') $coverBullets '01 / 06' (Join-Path $outDir '01-cover.png') '完全本地 · 开源免费 · 一个插件全搞定'

$a = @('B站 / 抖音：自动刷视频、点赞、收藏、分享', '抽帧看画面，是真看内容而不是只读标题', '还会自己发图文、回评论、写日记')
New-Poster '她还会自己刷视频' 'B站 / 抖音 的日常，交给她自己安排' (Join-Path $shots 'shot-behavior.png') $a '02 / 06' (Join-Path $outDir '02-behavior.png') '每天几条、看什么、点不点赞，面板里都能调'

$b = @('聊天会让她开心、吃醋、心疼、想念', '只影响语气：不改记忆、不改人格、不改事实', '规则驱动，零模型调用、零额外 token')
New-Poster '她有自己的心情' 'PAD 情绪场 · 14 个情绪通道 · 精力' (Join-Path $shots 'shot-emotion.png') $b '03 / 06' (Join-Path $outDir '03-emotion.png') '5 分钟向基线回落 · 跨夜恢复精力'

$c = @('按人、按渠道记住每句话，可搜可改可删', '每个人一份画像：好感 / 关系阶段 / 印象', '日记、周记、聊天归档一步到位')
New-Poster '记得你说过的每句话' '长期记忆 + 人物画像，越聊越懂你' (Join-Path $shots 'shot-memory.png') $c '04 / 06' (Join-Path $outDir '04-memory.png') '记忆存在本机 SQLite，不上传云端'

$d = @('QQ 扫码（SnowLuma）/ B站 面板内扫码 / 抖音专用窗口', '白名单、群管理、自动回复全部可调', '收到就回、主动开口，还能发语音')
New-Poster 'QQ / B站 / 抖音 都能聊' '一个面板登录三个平台，统一认成同一个人' (Join-Path $shots 'shot-channels.png') $d '05 / 06' (Join-Path $outDir '05-channels.png') '不用来回切软件，一个面板全搞定'

$e = @('GitHub：github.com/linkl-ike/my-fish', '安装：dsh plugin add <Release 的 tgz>', '市场索引：linkl-ike.github.io/my-fish/market/index.json', '版本 1.1.0 · 引擎 0.18.5-local.4')
New-Poster '一起来把她养大' '开源项目 · 欢迎一起完善' (Join-Path $shots 'shot-service.png') $e '06 / 06' (Join-Path $outDir '06-join.png') 'MIT 许可 · 数据全在本机 · 插件包不含任何用户数据'
