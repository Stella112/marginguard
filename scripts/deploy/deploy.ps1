# MarginGuard deployment - declare, deploy, and wire the spot-venue contracts.
#
# Scope: AgentRegistry, OrderBook, MarginGuardVenue - the spot dark pool plus the agent
# registry. The perp engine needs a price oracle (the Ekubo TWAP adapter, still to be built),
# so it deploys in a later pass; this script proves the declare/deploy/wire pipeline and puts
# the spot venue live.
#
# It never sees a private key. starkli signs from the encrypted keystore your env vars point at
# and prompts *you* for the keystore password at each signature.
#
# PowerShell 5.1 note: starkli writes progress to stderr. This script does NOT merge stderr into
# stdout (no `2>&1`) and runs with ErrorActionPreference=Continue, so that normal progress is not
# mistaken for a fatal error. Real failures are caught via $LASTEXITCODE.
#
# Prerequisites (see docs/DEPLOYMENT.md), then:
#   $env:STARKNET_ACCOUNT  = "C:\Users\Admin\.starkli\account.json"
#   $env:STARKNET_KEYSTORE = "C:\Users\Admin\.starkli\keystore.json"
#   $env:STARKNET_RPC      = "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8"
#   powershell -File C:\stark\scripts\deploy\deploy.ps1 -Pool 0x0254a6b2...
#
# Tip: to avoid retyping the keystore password on every transaction (TESTNET only), also set
#   $env:STARKNET_KEYSTORE_PASSWORD = "yourpassword"

param(
    [Parameter(Mandatory = $true)][string]$Pool
)

# Continue, not Stop: starkli's stderr progress must not abort the script.
$ErrorActionPreference = "Continue"

$starkli = "C:\Users\Admin\tools\starkli\starkli.exe"
$dev = Join-Path $PSScriptRoot "..\..\contracts\target\dev"
$resultFile = Join-Path $PSScriptRoot "deploy-result.txt"

function Fail($msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

foreach ($v in @("STARKNET_ACCOUNT", "STARKNET_KEYSTORE", "STARKNET_RPC")) {
    if (-not (Test-Path "Env:$v")) { Fail "Set `$env:$v before running (see docs/DEPLOYMENT.md)." }
}

Write-Host "RPC     : $env:STARKNET_RPC"
Write-Host "account : $env:STARKNET_ACCOUNT"
Write-Host "pool    : $Pool`n"

# Deterministic declaration class hash, computed locally (clean stdout, no network).
function Get-ClassHash($name) {
    $sierra = Join-Path $dev "marginguard_$name.contract_class.json"
    if (-not (Test-Path $sierra)) { Fail "missing artifact: $sierra (run 'scarb build')" }
    $h = & $starkli class-hash $sierra
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($h)) { Fail "class-hash failed for $name" }
    return $h.Trim()
}

# Declare a class. Idempotent: an already-declared class exits 0 with a note. A real failure
# (bad account, no funds) is a nonzero exit we surface.
#
# --casm-file supplies Scarb's already-compiled CASM, so starkli does NOT run its own bundled
# Sierra->CASM compiler. starkli 0.4.2's compiler predates Sierra 1.8.0 (emitted by Scarb 2.18)
# and would otherwise fail with "unsupported Sierra version: 1.8.0".
function Invoke-Declare($name) {
    $sierra = Join-Path $dev "marginguard_$name.contract_class.json"
    $casm = Join-Path $dev "marginguard_$name.compiled_contract_class.json"
    if (-not (Test-Path $casm)) { Fail "missing CASM: $casm (run 'scarb build')" }
    Write-Host "==> declaring $name" -ForegroundColor Cyan
    & $starkli declare $sierra --casm-file $casm --watch
    if ($LASTEXITCODE -ne 0) {
        Fail "declare $name failed (exit $LASTEXITCODE). If it says 'already declared', that is fine - re-run and it will skip."
    }
    Write-Host ""
}

# Deploy a class and return the deployed address. starkli prints the address as the final
# stdout line; progress goes to stderr (shown on console, not captured here).
function Invoke-Deploy($name, $classHash, [string[]]$ctorArgs) {
    Write-Host "==> deploying $name" -ForegroundColor Cyan
    $out = & $starkli deploy $classHash @ctorArgs --watch
    if ($LASTEXITCODE -ne 0) { Fail "deploy $name failed (exit $LASTEXITCODE)" }
    # The deployed address is the last 0x... token in stdout.
    $addr = ($out | Select-String -Pattern '0x[0-9a-fA-F]{1,64}' -AllMatches |
        ForEach-Object { $_.Matches } | Select-Object -Last 1).Value
    if ([string]::IsNullOrWhiteSpace($addr)) { Fail "could not read deployed address for $name from starkli output" }
    Write-Host "    $name : $addr`n"
    return $addr
}

# Class hashes (local, deterministic).
$registryClass = Get-ClassHash "AgentRegistry"
$bookClass = Get-ClassHash "OrderBook"
$venueClass = Get-ClassHash "MarginGuardVenue"
Write-Host "class hashes:"
Write-Host "  AgentRegistry    : $registryClass"
Write-Host "  OrderBook        : $bookClass"
Write-Host "  MarginGuardVenue : $venueClass`n"

# Declare.
Invoke-Declare "AgentRegistry"
Invoke-Declare "OrderBook"
Invoke-Declare "MarginGuardVenue"

# Deploy.
$registryAddr = Invoke-Deploy "AgentRegistry" $registryClass @()
$bookAddr = Invoke-Deploy "OrderBook" $bookClass @()
# Venue constructor: (privacy_pool, order_book)
$venueAddr = Invoke-Deploy "MarginGuardVenue" $venueClass @($Pool, $bookAddr)

# Wire the book to the venue so it will accept placements.
Write-Host "==> OrderBook.initialize_venue($venueAddr)" -ForegroundColor Cyan
& $starkli invoke $bookAddr initialize_venue $venueAddr --watch
if ($LASTEXITCODE -ne 0) { Fail "initialize_venue failed (exit $LASTEXITCODE)" }

$lines = @(
    "",
    "================ DEPLOYED (Sepolia) ================",
    "AgentRegistry    : $registryAddr",
    "OrderBook        : $bookAddr",
    "MarginGuardVenue : $venueAddr",
    "privacy pool     : $Pool",
    "==================================================="
)
foreach ($line in $lines) { Write-Host $line -ForegroundColor Green }
$lines | Out-File -Encoding utf8 $resultFile
Write-Host "Saved to $resultFile"
Write-Host "Paste the DEPLOYED block back to Claude to record it."
