Add-Type -AssemblyName System.Drawing

$outDir = 'C:\Users\MSI-\dsh-plugins\my-fish\promo'
$W = 1080; $H = 1440
$fontName = 'Microsoft YaHei'

function C([int]$r,[int]$g,[int]$b,[int]$a=255) { return [System.Drawing.Color]::FromArgb($a,$r,$g,$b) }
function F([float]$size,[string]$style='Regular') {
  $fs = [System.Drawing.FontStyle]::$style
  return New-Object System.Drawing.Font($fontName, $size, $fs, [System.Drawing.GraphicsUnit]::Pixel)
}
function Txt($g, [string]$text, [float]$x, [float]$y, $font, $color) {
  $b = New-Object System.Drawing.SolidBrush $color
  $g.DrawString($text, $font, $b, $x, $y)
  $b.Dispose()
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
function Para($g, [string]$text, [float]$x, [float]$y, [float]$w, $font, $color, [float]$lineGap) {
  $brush = New-Object System.Drawing.SolidBrush $color
  $sz = $g.MeasureString($text, $font, [int]$w)
  $rect = New-Object System.Drawing.RectangleF $x, $y, $w, ($sz.Height + $lineGap)
  $g.DrawString($text, $font, $brush, $rect)
  $brush.Dispose()
  return $sz.Height
}

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

# 顶部 badge
$w1 = Chip $g 'MY FISH' 72 78 (F 24 'Bold') (C 56 189 248 34) (C 125 211 252) (C 56 189 248 130)
Txt $g '前言 · PREFACE' (72 + $w1 + 14) 84 (F 22) (C 148 163 184)

# 标题
Txt $g '写在前面' 70 150 (F 74 'Bold') (C 248 250 252)
Txt $g '关于这个插件，和几句想说的话' 74 252 (F 30) (C 148 197 253)

# 分隔线
$linePen = New-Object System.Drawing.Pen (C 56 189 248 90), 2
$g.DrawLine($linePen, 72, 330, 1008, 330)
$linePen.Dispose()

# 正文
$bodyFont = F 33
$quoteFont = F 33 'Bold'
$colorBody = C 226 232 240
$colorQuote = C 147 197 253
$colorDim = C 203 213 225
$y = 380
$x = 72
$wBody = 936

$p1 = '大家好，我是这条鱼的主人。'
$y += (Para $g $p1 $x $y $wBody $bodyFont $colorBody 8) + 30

$p2 = '我在这里发布我用 DSH 做的养鱼插件：本插件旨在大家共同研究、发现问题、一起进步，也欢迎大家以它为基础，自行加入其他功能。'
$y += (Para $g $p2 $x $y $wBody $bodyFont $colorBody 8) + 30

Txt $g '有言' $x $y $bodyFont $colorBody
$quote = '「学得越早，学得越晚」'
$qWidth = $g.MeasureString($quote, $quoteFont).Width
Txt $g $quote ($x + 76) $y $quoteFont $colorQuote
Txt $g '—— 等我后续更新也行。' ($x + 76 + $qWidth + 8) $y $bodyFont $colorBody
$y += 66

$p4 = '在此感谢我的 DSH 小帮手为该插件做的贡献，感谢梁圣。'
$y += (Para $g $p4 $x $y $wBody $bodyFont $colorDim 8)

# 署名
$sign = '—— @明日依旧美好'
$signFont = F 30
$signWidth = $g.MeasureString($sign, $signFont).Width
Txt $g $sign ($W - 72 - $signWidth) ($y + 56) $signFont (C 125 211 252)


# 底部信息块
$linePen2 = New-Object System.Drawing.Pen (C 56 189 248 70), 2
$g.DrawLine($linePen2, 72, 966, 1008, 966)
$linePen2.Dispose()
$infoFont = F 25
$infoColor = C 148 163 184
Txt $g 'my fish · 一个跑在 DeepSeek Harness 上的养鱼插件' 72 1006 $infoFont $infoColor
Txt $g '开源 · MIT 许可 · 数据全部保存在本机' 72 1052 $infoFont $infoColor
Txt $g '欢迎 Fork、提 Issue、一起把它养大' 72 1098 $infoFont $infoColor
# 页脚
Txt $g 'my fish · DeepSeek Harness 养鱼插件 · v1.1.0' 72 1358 (F 22) (C 100 116 139)
Txt $g '00 / 07' ($W - 72 - 84) 1356 (F 24 'Bold') (C 125 211 252)

$out = Join-Path $outDir '00-preface.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $g.Dispose()
"saved $out"
