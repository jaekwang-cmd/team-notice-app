$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $PSScriptRoot 'DesktopForeground.cs'
$outputFile = Join-Path $projectRoot 'build/desktop-foreground.exe'
$compiler = @('Framework64','Framework') |
  ForEach-Object { Join-Path $env:WINDIR "Microsoft.NET/$_/v4.0.30319/csc.exe" } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $compiler) { throw 'Windows .NET Framework C# compiler was not found.' }
& $compiler /nologo /target:exe /optimize+ "/out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) { throw "DesktopForeground compile failed ($LASTEXITCODE)." }
