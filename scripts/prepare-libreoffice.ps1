# Prepares the bundled LibreOffice engine (MPL-2.0) used to open Word / Excel / PowerPoint files as PDF.
# Downloads the pinned official Windows x64 MSI, checks its SHA-256 and extracts the program files with
# an administrative install (msiexec /a): nothing is registered or installed on the build machine.
# Result: vendor/libreoffice/{program,share,...}, plus manifest.json. Not committed (see .gitignore).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the 5.1 progress bar makes large downloads very slow
$version = '26.2.6'
$sha256 = 'f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660'
$msiName = "LibreOffice_${version}_Win_x86-64.msi"
$url = "https://download.documentfoundation.org/libreoffice/stable/$version/win/x86_64/$msiName"

$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root 'vendor\libreoffice'
$manifestPath = Join-Path $destination 'manifest.json'
if ((Test-Path -LiteralPath $manifestPath) -and ((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version -eq $version) -and (Test-Path -LiteralPath (Join-Path $destination 'program\soffice.com'))) { Write-Output "Verified bundled LibreOffice $version."; exit 0 }

$downloads = Join-Path $root '.downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$msi = Join-Path $downloads $msiName
if (-not (Test-Path -LiteralPath $msi) -or (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) {
    Write-Output "Downloading $msiName ..."
    Invoke-WebRequest -Uri $url -OutFile $msi
}
if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'LibreOffice download checksum mismatch.' }

$stage = Join-Path ([IO.Path]::GetTempPath()) ('qingye-libreoffice-' + [guid]::NewGuid().ToString('N'))
try {
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$stage`"") -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "msiexec /a failed with exit code $($process.ExitCode)." }
    $source = Get-ChildItem -LiteralPath $stage -Directory -Recurse -Filter 'program' | Where-Object { Test-Path (Join-Path $_.FullName 'soffice.com') } | Select-Object -First 1
    if (-not $source) { throw 'soffice.com not found in the extracted MSI.' }
    $installRoot = $source.Parent.FullName
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    New-Item -ItemType Directory -Path $destination | Out-Null
    Get-ChildItem -LiteralPath $installRoot | Where-Object { $_.Name -notin @('help', 'System', 'update-settings.ini') -and $_.Extension -ne '.msi' } | Copy-Item -Destination $destination -Recurse -Force
    # Headless conversion needs the filters, the default configuration and fonts. User-interface
    # translations, language packs, spelling dictionaries and extra icon themes are not used (Python
    # stays: soffice loads it at start-up),
    # so only Chinese and English resources are kept (this takes the engine from ~1.5 GB to ~0.5 GB).
    $keepLang = @('en-US', 'en', 'zh-CN', 'zh-TW')
    $program = Join-Path $destination 'program'
    $share = Join-Path $destination 'share'
    # The MSVC runtime normally installed system-wide is deployed app-locally next to soffice.
    Get-ChildItem -LiteralPath (Join-Path $destination 'System64') -File | Copy-Item -Destination $program -Force
    Remove-Item -LiteralPath (Join-Path $destination 'System64') -Recurse -Force
    # Fonts that LibreOffice installs into Windows (metric-compatible Liberation, Carlito, Caladea, …)
    # are loaded from share/fonts/truetype instead.
    $fonts = Join-Path $share 'fonts\truetype'; New-Item -ItemType Directory -Path $fonts -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $destination 'Fonts') -File | Move-Item -Destination $fonts -Force
    Remove-Item -LiteralPath (Join-Path $destination 'Fonts') -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $program 'resource') -Directory | Where-Object { $_.Name -notin $keepLang } | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $share 'extensions') -Directory | Where-Object { $_.Name -like 'dict-*' -and $_.Name -ne 'dict-en' } | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $share 'registry') -File -Filter 'Langpack-*.xcd' | Where-Object { $_.BaseName.Substring(9) -notin $keepLang } | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $share 'registry\res') -File | Where-Object { $_.BaseName -match '_([A-Za-z-]+)$' -and $Matches[1] -notin $keepLang } | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $share 'config') -File -Filter 'images_*.zip' | Where-Object { $_.Name -notin @('images_colibre.zip', 'images_colibre_svg.zip') } | Remove-Item -Force
    $exe = Join-Path $destination 'program\soffice.com'
    [ordered]@{
        name = 'LibreOffice'; version = $version; license = 'MPL-2.0 (with LGPLv3+ and third-party components; see readmes and LICENSE.html)'
        upstream = $url; msiSha256 = $sha256; source = "https://download.documentfoundation.org/libreoffice/src/$version/"
        modified = $false; removed = @('help', 'non-Chinese/English UI resources, language packs and dictionaries', 'extra icon themes'); relocated = @('System64 MSVC runtime -> program', 'Fonts -> share/fonts/truetype')
    } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Write-Output "Prepared LibreOffice $version at $destination ($([math]::Round((Get-ChildItem -LiteralPath $destination -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)) MB)."
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
