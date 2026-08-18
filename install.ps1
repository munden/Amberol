<#
.SYNOPSIS
    Installs the Amberola Cylinder Register on a fresh Windows machine.

.DESCRIPTION
    Takes a computer with nothing on it and leaves a working register.

    Installs Node.js and PostgreSQL if they are missing, starts the database
    service, creates the role and database, loads the master catalog, and
    optionally starts the application.

    Every step checks before it acts, so running this twice is safe. Nothing
    already installed is reinstalled, and nothing already correct is changed.

.PARAMETER SuperPassword
    Password for the PostgreSQL "postgres" superuser. On a machine where
    PostgreSQL is already installed this must be the password already in use.
    Where this script installs PostgreSQL itself, this becomes the password.
    Omit it and you will be asked.

.PARAMETER AppPassword
    Password for the "amberola" role the register logs in as. Defaults to
    "amberola". Only worth changing if the database is reachable from
    elsewhere on your network.

.PARAMETER Path
    Where to put the register. Defaults to a folder named Amberol beside this
    script if it is already a checkout, otherwise $HOME\Amberol.

.PARAMETER NoStart
    Set up everything but do not start the application at the end.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -SuperPassword 'my postgres password' -NoStart
#>
[CmdletBinding()]
param(
    [string] $SuperPassword,
    [string] $AppPassword = 'amberola',
    [string] $Path,
    [switch] $NoStart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoUrl      = 'https://github.com/munden/Amberol.git'
$RepoBranch   = 'claude/amberola-cylinder-database-n4w5c4'
$NodeMinMajor = 20
$DbName       = 'amberola'
$DbUser       = 'amberola'
$DbPort       = 5432

# --------------------------------------------------------------- presentation

$script:StepNumber = 0

function Write-Step {
    param([string] $Message)
    $script:StepNumber++
    Write-Host ''
    Write-Host ("==> [{0}] {1}" -f $script:StepNumber, $Message) -ForegroundColor Cyan
}

function Write-Ok   { param([string] $m) Write-Host "    $m" -ForegroundColor Green }
function Write-Info { param([string] $m) Write-Host "    $m" -ForegroundColor Gray }
function Write-Warn { param([string] $m) Write-Host "    $m" -ForegroundColor Yellow }

<#
    Stops with an explanation and, where there is one, the thing to do next.
    Every failure in this script goes through here so none of them is a bare
    stack trace.
#>
function Stop-WithAdvice {
    param(
        [Parameter(Mandatory)][string] $Problem,
        [string] $Advice
    )
    Write-Host ''
    Write-Host ('-' * 70) -ForegroundColor Red
    Write-Host "INSTALL STOPPED" -ForegroundColor Red
    Write-Host ''
    Write-Host $Problem -ForegroundColor Red
    if ($Advice) {
        Write-Host ''
        Write-Host $Advice
    }
    Write-Host ('-' * 70) -ForegroundColor Red
    exit 1
}

# ------------------------------------------------------------------ utilities

<#
    Re-reads PATH from the registry into this session.

    An installer writes the machine and user PATH, but a process that is
    already running keeps the copy it started with — which is why a freshly
    installed node or psql is "not recognized" until you open a new terminal.
    Pulling both scopes back in lets this script keep going in one pass.
#>
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Command {
    param([Parameter(Mandatory)][string] $Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Administrator {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
    Runs a command and returns its exit code and output together.

    Native commands do not raise terminating errors, so $ErrorActionPreference
    does nothing for them; each call has to be checked. This keeps that check
    in one place.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string] $File,
        [string[]] $Arguments = @(),
        [string] $WorkingDirectory,
        [switch] $Quiet
    )

    if (-not (Test-Command $File)) {
        return [pscustomobject]@{
            ExitCode = 127
            Output   = "$File is not on PATH."
            Ok       = $false
        }
    }

    $originalLocation = Get-Location
    try {
        if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }

        if ($Quiet) {
            $output = & $File @Arguments 2>&1
        } else {
            & $File @Arguments 2>&1 | Tee-Object -Variable output | Out-Host
        }

        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($output | Out-String)
            Ok       = ($LASTEXITCODE -eq 0)
        }
    } finally {
        Set-Location -LiteralPath $originalLocation
    }
}

function Read-Secret {
    param([Parameter(Mandatory)][string] $Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# ------------------------------------------------------------------ the steps

function Assert-WindowsVersion {
    Write-Step 'Checking Windows'

    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Stop-WithAdvice -Problem "This script needs PowerShell 5 or newer; this is $($PSVersionTable.PSVersion)." `
                        -Advice  'Update Windows, or install PowerShell 7 from https://aka.ms/powershell'
    }

    $os = try { (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch { 'Windows' }
    Write-Ok "$os, PowerShell $($PSVersionTable.PSVersion)"

    if (-not (Test-Administrator)) {
        Write-Warn 'Not running as Administrator.'
        Write-Warn 'Installing Node or PostgreSQL, and starting the database service,'
        Write-Warn 'both need it. If either is already installed and running you can'
        Write-Warn 'carry on; otherwise stop, right-click PowerShell, and choose'
        Write-Warn '"Run as administrator".'
        Write-Host ''
        $answer = Read-Host '    Carry on anyway? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Stop-WithAdvice -Problem 'Stopped at your request.' `
                            -Advice  'Re-run this script from an Administrator PowerShell.'
        }
    } else {
        Write-Ok 'Running as Administrator'
    }
}

function Get-WingetOrNull {
    if (Test-Command 'winget') { return 'winget' }
    Update-SessionPath
    if (Test-Command 'winget') { return 'winget' }
    return $null
}

function Install-NodeIfMissing {
    Write-Step 'Node.js'

    $needed = $true
    if (Test-Command 'node') {
        $raw = (& node --version) 2>&1 | Out-String
        if ($raw -match 'v(\d+)\.') {
            $major = [int]$Matches[1]
            if ($major -ge $NodeMinMajor) {
                Write-Ok "already installed ($($raw.Trim()))"
                $needed = $false
            } else {
                Write-Warn "found $($raw.Trim()), but $NodeMinMajor or newer is required"
            }
        }
    }

    if (-not $needed) { return }

    $winget = Get-WingetOrNull
    if (-not $winget) {
        Stop-WithAdvice -Problem 'Node.js is missing and winget is not available to install it.' `
                        -Advice  ("Install Node.js LTS by hand from https://nodejs.org/ ,`n" +
                                  'then open a new PowerShell and run this script again.')
    }

    Write-Info 'installing Node.js LTS — this takes a few minutes'
    $result = Invoke-Native -File $winget -Arguments @(
        'install', '--id', 'OpenJS.NodeJS.LTS',
        '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements'
    )

    # winget reports "no applicable upgrade" as a failure; a working node after
    # the fact is the answer that matters, so PATH is refreshed and rechecked
    # before anything is called a failure.
    Update-SessionPath

    if (-not (Test-Command 'node')) {
        Stop-WithAdvice -Problem "Node.js still is not available after installing (winget exit code $($result.ExitCode))." `
                        -Advice  ("Install it by hand from https://nodejs.org/ , then open a NEW`n" +
                                  'PowerShell window and run this script again.')
    }

    Write-Ok "installed ($(((& node --version) 2>&1 | Out-String).Trim()))"
}

function Install-GitIfMissing {
    Write-Step 'Git'

    if (Test-Command 'git') {
        Write-Ok 'already installed'
        return
    }

    $winget = Get-WingetOrNull
    if (-not $winget) {
        Stop-WithAdvice -Problem 'Git is missing and winget is not available to install it.' `
                        -Advice  'Install Git from https://git-scm.com/download/win and run this script again.'
    }

    Write-Info 'installing Git'
    Invoke-Native -File $winget -Arguments @(
        'install', '--id', 'Git.Git',
        '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements'
    ) | Out-Null

    Update-SessionPath

    if (-not (Test-Command 'git')) {
        Stop-WithAdvice -Problem 'Git still is not available after installing.' `
                        -Advice  'Install it from https://git-scm.com/download/win , then re-run this script.'
    }
    Write-Ok 'installed'
}

function Get-PostgresService {
    Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
        Sort-Object -Property Name -Descending |
        Select-Object -First 1
}

function Install-PostgresIfMissing {
    Write-Step 'PostgreSQL'

    $service = Get-PostgresService
    if ($service) {
        Write-Ok "already installed ($($service.Name))"
        return $false
    }

    Write-Info 'not installed'

    if (-not (Test-Administrator)) {
        Stop-WithAdvice -Problem 'PostgreSQL is not installed, and installing it needs Administrator rights.' `
                        -Advice  'Right-click PowerShell, choose "Run as administrator", and run this script again.'
    }

    $winget = Get-WingetOrNull
    if (-not $winget) {
        Stop-WithAdvice -Problem 'PostgreSQL is missing and winget is not available to install it.' `
                        -Advice  ("Install it from https://www.postgresql.org/download/windows/ ,`n" +
                                  "note the superuser password you choose, then run this script again.")
    }

    if (-not $script:SuperPassword) {
        Write-Host ''
        Write-Info 'Choose a password for the PostgreSQL superuser ("postgres").'
        Write-Info 'Write it down — it is not recoverable, and you will need it if you'
        Write-Info 'ever administer the database by hand.'
        Write-Host ''
        $first  = Read-Secret '    New superuser password'
        $second = Read-Secret '    Type it again'
        if ($first -ne $second) {
            Stop-WithAdvice -Problem 'Those two passwords did not match.' -Advice 'Run the script again.'
        }
        if ([string]::IsNullOrWhiteSpace($first)) {
            Stop-WithAdvice -Problem 'An empty superuser password is not allowed.' -Advice 'Run the script again.'
        }
        $script:SuperPassword = $first
    }

    Write-Info 'installing PostgreSQL — this takes several minutes, and is quiet while it works'

    # The EDB installer takes its own flags through winget's --custom. Passing
    # the password here is what makes an unattended install possible at all.
    $custom = '--mode unattended --unattendedmodeui minimal ' +
              "--superpassword `"$($script:SuperPassword)`" " +
              "--serverport $DbPort --enable-components server,commandlinetools"

    $result = $null
    foreach ($packageId in @('PostgreSQL.PostgreSQL.17', 'PostgreSQL.PostgreSQL')) {
        $result = Invoke-Native -File $winget -Arguments @(
            'install', '--id', $packageId,
            '--exact', '--silent',
            '--accept-package-agreements', '--accept-source-agreements',
            '--custom', $custom
        )
        Update-SessionPath
        Start-Sleep -Seconds 5
        if (Get-PostgresService) { break }
        Write-Warn "$packageId did not take; trying the next package id"
    }

    if (-not (Get-PostgresService)) {
        Stop-WithAdvice -Problem "PostgreSQL did not install (winget exit code $($result.ExitCode))." `
                        -Advice  ("Install it by hand from https://www.postgresql.org/download/windows/ .`n" +
                                  "Keep the Server and Command Line Tools components, note the`n" +
                                  'superuser password, then run this script again.')
    }

    Write-Ok 'installed'
    return $true
}

function Start-PostgresService {
    Write-Step 'PostgreSQL service'

    $service = Get-PostgresService
    if (-not $service) {
        Stop-WithAdvice -Problem 'No PostgreSQL service is registered on this machine.' `
                        -Advice  ("A client-only installation is not enough. Reinstall from`n" +
                                  'https://www.postgresql.org/download/windows/ with the Server component ticked.')
    }

    if ($service.Status -ne 'Running') {
        if (-not (Test-Administrator)) {
            Stop-WithAdvice -Problem "The service $($service.Name) is $($service.Status), and starting it needs Administrator rights." `
                            -Advice  "From an Administrator PowerShell:  Start-Service -Name '$($service.Name)'"
        }
        Write-Info "starting $($service.Name)"
        try {
            Start-Service -Name $service.Name -ErrorAction Stop
            $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
        } catch {
            Stop-WithAdvice -Problem "The service $($service.Name) would not start: $($_.Exception.Message)" `
                            -Advice  ('Look at the PostgreSQL log under its data directory, or start it from ' +
                                      'services.msc to see the error Windows reports.')
        }
    }

    # Being "Running" is not the same as accepting connections; the postmaster
    # takes a moment more, and a fresh install takes longer still.
    $deadline = (Get-Date).AddSeconds(60)
    do {
        $listening = try {
            (Test-NetConnection -ComputerName '127.0.0.1' -Port $DbPort -InformationLevel Quiet -WarningAction SilentlyContinue)
        } catch { $false }
        if ($listening) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    if (-not $listening) {
        Stop-WithAdvice -Problem "The service is running but nothing is accepting connections on port $DbPort." `
                        -Advice  ('Another PostgreSQL may be using the port, or the server is still starting. ' +
                                  'Wait a moment and run this script again.')
    }

    Write-Ok "running, and accepting connections on port $DbPort"
}

function Resolve-RepositoryPath {
    Write-Step 'The register itself'

    $candidates = @()
    if ($script:Path) { $candidates += $script:Path }
    if ($PSScriptRoot) { $candidates += $PSScriptRoot }
    $candidates += (Join-Path $HOME 'Amberol')

    foreach ($candidate in $candidates) {
        $marker = Join-Path $candidate 'server\src\index.js'
        if (Test-Path -LiteralPath $marker) {
            Write-Ok "found at $candidate"
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $target = if ($script:Path) { $script:Path } else { Join-Path $HOME 'Amberol' }

    if (Test-Path -LiteralPath $target) {
        $entries = @(Get-ChildItem -LiteralPath $target -Force -ErrorAction SilentlyContinue)
        if ($entries.Count -gt 0) {
            Stop-WithAdvice -Problem "$target already exists and is not a checkout of the register." `
                            -Advice  'Move it aside, or pass a different folder with -Path.'
        }
    }

    Write-Info "cloning into $target"
    $clone = Invoke-Native -File 'git' -Arguments @('clone', '--branch', $RepoBranch, $RepoUrl, $target)
    if (-not $clone.Ok) {
        Stop-WithAdvice -Problem 'Could not clone the repository.' `
                        -Advice  ("Check the network, and that you can reach GitHub. To use a copy you`n" +
                                  'already have, run this script from inside it, or pass -Path.')
    }

    Write-Ok "cloned to $target"
    return (Resolve-Path -LiteralPath $target).Path
}

function Install-Register {
    param([Parameter(Mandatory)][string] $RepositoryPath)

    Write-Step 'Installing and loading the catalog'

    if (-not $script:SuperPassword) {
        Write-Host ''
        Write-Info 'The superuser password is needed once, to create the register''s own'
        Write-Info 'database. This is the password set when PostgreSQL was installed.'
        Write-Host ''
        $script:SuperPassword = Read-Secret '    Password for postgres'
        if ([string]::IsNullOrWhiteSpace($script:SuperPassword)) {
            Stop-WithAdvice -Problem 'No password given.' -Advice 'Run the script again.'
        }
    }

    # setup.mjs reads both of these, so it never has to prompt.
    $env:PGPASSWORD  = $script:SuperPassword
    $encodedUser = [Uri]::EscapeDataString($DbUser)
    $encodedPass = [Uri]::EscapeDataString($AppPassword)
    $env:DATABASE_URL = "postgres://${encodedUser}:${encodedPass}@127.0.0.1:${DbPort}/${DbName}"

    try {
        $setup = Invoke-Native -File 'npm' -Arguments @('run', 'setup') -WorkingDirectory $RepositoryPath

        if (-not $setup.Ok) {
            $hint = if ($setup.Output -match 'refused the password') {
                "That superuser password was refused. Run this script again and give the`n" +
                'password set when PostgreSQL was installed.'
            } elseif ($setup.Output -match 'ECONNREFUSED|Nothing is listening') {
                'The database stopped accepting connections part way through. Check the service and re-run.'
            } else {
                "Read the output above for the failing step. Running" +
                " 'npm run doctor' in $RepositoryPath re-checks each part in turn."
            }
            Stop-WithAdvice -Problem 'Setting up the register failed.' -Advice $hint
        }
    } finally {
        # Never leave the superuser password lying about in the environment.
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }

    Write-Ok 'installed, migrated and seeded'
}

function Confirm-Install {
    param([Parameter(Mandatory)][string] $RepositoryPath)

    Write-Step 'Checking it over'

    $doctor = Invoke-Native -File 'npm' -Arguments @('run', 'doctor') -WorkingDirectory $RepositoryPath -Quiet
    Write-Host $doctor.Output

    if (-not $doctor.Ok) {
        Stop-WithAdvice -Problem 'The installation is not complete — see the check above.' `
                        -Advice  "Run 'npm run doctor' in $RepositoryPath after fixing it."
    }

    Write-Ok 'everything checks out'
}

function Start-Register {
    param([Parameter(Mandatory)][string] $RepositoryPath)

    Write-Step 'Starting the register'
    Write-Info 'Building the front end and starting the server. This window keeps it'
    Write-Info 'running — press Ctrl+C to stop it.'
    Write-Host ''
    Write-Host '    Open http://localhost:4310' -ForegroundColor Green
    Write-Host ''

    Start-Job -ScriptBlock {
        Start-Sleep -Seconds 25
        Start-Process 'http://localhost:4310'
    } | Out-Null

    Invoke-Native -File 'npm' -Arguments @('start') -WorkingDirectory $RepositoryPath | Out-Null
}

# ------------------------------------------------------------------ main

try {
    Write-Host ''
    Write-Host 'The Amberola Cylinder Register — installer' -ForegroundColor White
    Write-Host 'A catalogue of four-minute cylinders, and a record of the ones you own.' -ForegroundColor Gray

    Assert-WindowsVersion
    Install-GitIfMissing
    Install-NodeIfMissing
    Install-PostgresIfMissing | Out-Null
    Start-PostgresService

    $repository = Resolve-RepositoryPath
    Install-Register -RepositoryPath $repository
    Confirm-Install  -RepositoryPath $repository

    Write-Host ''
    Write-Host ('-' * 70) -ForegroundColor Green
    Write-Host 'READY' -ForegroundColor Green
    Write-Host ''
    Write-Host "  The register is installed at $repository"
    Write-Host ''
    Write-Host '  Start it any time with:'
    Write-Host "      cd `"$repository`"" -ForegroundColor White
    Write-Host '      npm start' -ForegroundColor White
    Write-Host ''
    Write-Host '  Then open http://localhost:4310'
    Write-Host ''
    Write-Host '  If anything goes wrong later:  npm run doctor'
    Write-Host ('-' * 70) -ForegroundColor Green

    if (-not $NoStart) {
        Start-Register -RepositoryPath $repository
    }
}
catch {
    Stop-WithAdvice -Problem "Unexpected error: $($_.Exception.Message)" `
                    -Advice  ("Where it happened:`n$($_.ScriptStackTrace)`n`n" +
                              'Re-running is safe — every step checks before it acts.')
}
