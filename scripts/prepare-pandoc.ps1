$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'vendor\pandoc\manifest.json') -Raw | ConvertFrom-Json
$taskDestination = Join-Path $taskRoot 'vendor\pandoc'
$taskExecutable = Join-Path $taskDestination 'pandoc.exe'
if ((Test-Path -LiteralPath $taskExecutable) -and ((Get-FileHash -LiteralPath $taskExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskManifest.sha256)) { Write-Output 'Verified bundled Pandoc 3.12.'; exit 0 }
$taskTemporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskStage = Join-Path $taskTemporaryBase ('qingye-pandoc-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskStage | Out-Null
try {
    $taskZip = Join-Path $taskStage 'pandoc.zip'
    Invoke-WebRequest -Uri 'https://github.com/jgm/pandoc/releases/download/3.12/pandoc-3.12-windows-x86_64.zip' -OutFile $taskZip
    if ((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '2a77ebc2517d13e95056e76b1cd5b574cfe958ac61aa6058117d80c22ca19b79') { throw 'Pandoc download checksum mismatch.' }
    Expand-Archive -LiteralPath $taskZip -DestinationPath (Join-Path $taskStage 'unpacked')
    $taskSource = Join-Path $taskStage 'unpacked\pandoc-3.12'
    if ((Get-FileHash -LiteralPath (Join-Path $taskSource 'pandoc.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskManifest.sha256) { throw 'Pandoc executable checksum mismatch.' }
    New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
    Get-ChildItem -LiteralPath $taskSource -File | Copy-Item -Destination $taskDestination -Force
    Write-Output 'Prepared verified Pandoc 3.12.'
} finally {
    $taskResolvedStage = [IO.Path]::GetFullPath($taskStage)
    if (([IO.Path]::GetDirectoryName($taskResolvedStage).TrimEnd('\') -eq $taskTemporaryBase.TrimEnd('\')) -and ([IO.Path]::GetFileName($taskResolvedStage).StartsWith('qingye-pandoc-'))) { Remove-Item -LiteralPath $taskResolvedStage -Recurse -Force }
}
