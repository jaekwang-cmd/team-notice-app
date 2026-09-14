# PowerShell 5.1 / 7. Installs the verified release and keeps the existing user profile.
$ErrorActionPreference = 'Stop'
$version = '0.39.3'
$expectedHash = '3e7b594b6df7eb9a8e5ad572f4a6de1955151e50febdb98ba7d981d00e1f50bc'
$projectPath = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $projectPath ('dist\team-notice-app-setup-' + $version + '.exe')
if (-not (Test-Path -LiteralPath $installerPath)) {
  $downloadDir = Join-Path $env:TEMP ('team-notice-update\' + $version)
  New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
  $installerPath = Join-Path $downloadDir ('team-notice-app-setup-' + $version + '.exe')
  $downloadUrl = 'https://github.com/jaekwang-cmd/team-notice-app/releases/download/v' + $version + '/team-notice-app-setup-' + $version + '.exe'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host ('설치 파일 다운로드: ' + $version)
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $installerPath
}
$actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw '설치 파일 검증에 실패했습니다. 설치하지 않았습니다.' }
Write-Host ('여백을 ' + $version + ' 버전으로 업데이트합니다.')
$installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $installer.WaitForExit(180000)) { throw '설치가 아직 진행 중입니다. 설치 상태를 확인해주세요.' }
if ($installer.ExitCode -ne 0) { throw ('설치 프로그램 종료 코드: ' + $installer.ExitCode) }
$appPath = Join-Path $env:LOCALAPPDATA 'Programs\team-notice-app\여백.exe'
if (-not (Test-Path -LiteralPath $appPath)) { throw '설치된 프로그램을 찾지 못했습니다.' }
$installedVersion = (Get-Item -LiteralPath $appPath).VersionInfo.ProductVersion
if ($installedVersion -notmatch ('^' + [regex]::Escape($version) + '(\.|$)')) { throw ('설치 버전이 다릅니다: ' + $installedVersion) }
$running = Get-CimInstance Win32_Process -Filter "Name = '여백.exe'" | Where-Object { $_.ExecutablePath -eq $appPath }
if (-not $running) { Start-Process -FilePath $appPath -WindowStyle Hidden | Out-Null }
Write-Host ('업데이트 완료: ' + $installedVersion)
Write-Host ('프로그램: ' + $appPath)
