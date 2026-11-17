#Requires -Version 5.1
# my fish: GitHub SSH over 443 setup (works when github.com:443 is blocked).
# Usage: powershell -ExecutionPolicy Bypass -File tools/setup-github-ssh.ps1

param(
  [string]$KeyPath = (Join-Path $HOME ".ssh\my-fish_github"),
  [string]$HostAlias = "github.com"
)

$ErrorActionPreference = "Stop"

$sshDir = Split-Path -Parent $KeyPath
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Force -Path $sshDir | Out-Null }

if (-not (Test-Path $KeyPath)) {
  Write-Host "Generating SSH key: $KeyPath"
  & ssh-keygen -t ed25519 -f $KeyPath -N '""' -C "my-fish" | Out-Null
} else {
  Write-Host "SSH key already exists: $KeyPath"
}

$configPath = Join-Path $sshDir "config"
$marker = "# my-fish github over 443"
$block = @"
$marker
Host $HostAlias
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile $KeyPath
  IdentitiesOnly yes
"@

$existing = if (Test-Path $configPath) { Get-Content $configPath -Raw } else { "" }
if ($existing -notmatch [regex]::Escape($marker)) {
  Add-Content -Path $configPath -Value "`r`n$block" -Encoding ASCII
  Write-Host "Added SSH config block to $configPath"
} else {
  Write-Host "SSH config block already present: $configPath"
}

$pub = Get-Content "$KeyPath.pub" -Raw

Write-Host ""
Write-Host "================ PUBLIC KEY (add it to GitHub) ================"
Write-Host $pub.Trim()
Write-Host "==============================================================="
Write-Host ""
Write-Host "How to add it (github.com web is blocked on this network):"
Write-Host "  1) Open https://github.com/settings/keys on a device/network that can reach GitHub"
Write-Host "     (phone hotspot, another network, temporary VPN, or a friend's computer)."
Write-Host "  2) New SSH key -> paste the key above -> Save."
Write-Host "  -- OR with an existing PAT (token) on any machine --"
Write-Host "     curl -X POST -H `"Authorization: token `$env:GITHUB_TOKEN`" -H `"Accept: application/vnd.github+json`" ^"
Write-Host "       https://api.github.com/user/keys -d `"{\`"title\`":\`"my-fish\`",\`"key\`":\`"<paste public key>\`"}`""
Write-Host ""
Write-Host "Then test (SSH over 443):"
Write-Host "  ssh -T git@github.com"
Write-Host "Expected: Hi <your-name>! You've successfully authenticated..."
Write-Host ""
Write-Host "Then push:"
Write-Host "  git remote add origin git@github.com:<GITHUB_USER>/my-fish.git"
Write-Host "  git branch -M main"
Write-Host "  git push -u origin main"
