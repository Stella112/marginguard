# MarginGuard deployment — declare, deploy, and wire the three contracts.
#
# This is a thin, auditable wrapper over starkli. It declares each class, deploys OrderBook
# and MarginGuardVenue, then calls OrderBook.initialize_venue so the book will accept the
# venue. AgentRegistry is standalone and takes no constructor args.
#
# It never sees or asks for a private key. You point starkli at your own account and keystore
# via the two environment variables below; starkli reads the key from your encrypted keystore
# and prompts you for its password at signing time.
#
# Prerequisites (done once, by you — see docs/DEPLOYMENT.md):
#   - starkli on PATH (installed at C:\Users\Admin\tools\starkli\starkli.exe)
#   - an account descriptor JSON and an encrypted keystore JSON for a funded account
#   - $env:STARKNET_RPC set to a working RPC for the target network
#
# Usage:
#   $env:STARKNET_ACCOUNT = "C:\path\to\account.json"
#   $env:STARKNET_KEYSTORE = "C:\path\to\keystore.json"
#   $env:STARKNET_RPC = "https://free-rpc.nethermind.io/sepolia-juno/"
#   # POOL is the STRK20 privacy pool for the target network:
#   #   Sepolia: 0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91
#   #   Mainnet: 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
#   powershell -File scripts\deploy\deploy.ps1 -Pool 0x0254a6b2...

param(
    [Parameter(Mandatory = $true)][string]$Pool
)

$ErrorActionPreference = "Stop"
$starkli = "C:\Users\Admin\tools\starkli\starkli.exe"
$dev = Join-Path $PSScriptRoot "..\..\contracts\target\dev"

function Require-Env($name) {
    $val = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($val)) { throw "Set `$env:$name before running." }
    return $val
}

$account = Require-Env "STARKNET_ACCOUNT"
$keystore = Require-Env "STARKNET_KEYSTORE"
$rpc = Require-Env "STARKNET_RPC"

Write-Host "RPC     : $rpc"
Write-Host "account : $account"
Write-Host "pool    : $Pool"
Write-Host ""

# starkli reads account + keystore from these; --watch blocks until the tx is accepted.
$common = @("--account", $account, "--keystore", $keystore, "--rpc", $rpc, "--watch")

function Declare($name) {
    $sierra = Join-Path $dev "marginguard_$name.contract_class.json"
    if (-not (Test-Path $sierra)) { throw "missing artifact: $sierra (run 'scarb build' first)" }
    Write-Host "==> declaring $name"
    # Declaring an already-declared class is a no-op that still prints the class hash.
    $out = & $starkli declare $sierra @common 2>&1
    $out | Write-Host
    $hash = ($out | Select-String -Pattern "0x[0-9a-fA-F]{60,64}" | Select-Object -Last 1).Matches.Value
    if (-not $hash) { throw "could not parse class hash for $name" }
    Write-Host "    class hash: $hash`n"
    return $hash
}

function Deploy($name, $classHash, [string[]]$ctorArgs) {
    Write-Host "==> deploying $name"
    $out = & $starkli deploy $classHash @ctorArgs @common 2>&1
    $out | Write-Host
    $addr = ($out | Select-String -Pattern "0x[0-9a-fA-F]{60,64}" | Select-Object -Last 1).Matches.Value
    if (-not $addr) { throw "could not parse deployed address for $name" }
    Write-Host "    address: $addr`n"
    return $addr
}

$registryClass = Declare "AgentRegistry"
$bookClass     = Declare "OrderBook"
$venueClass    = Declare "MarginGuardVenue"

$registryAddr = Deploy "AgentRegistry" $registryClass @()
$bookAddr      = Deploy "OrderBook" $bookClass @()
# Venue constructor: (privacy_pool, order_book)
$venueAddr     = Deploy "MarginGuardVenue" $venueClass @($Pool, $bookAddr)

Write-Host "==> wiring OrderBook.initialize_venue($venueAddr)"
& $starkli invoke $bookAddr initialize_venue $venueAddr @common | Write-Host

Write-Host ""
Write-Host "================ DEPLOYED ================"
Write-Host "AgentRegistry    : $registryAddr"
Write-Host "OrderBook        : $bookAddr"
Write-Host "MarginGuardVenue : $venueAddr"
Write-Host "privacy pool     : $Pool"
Write-Host "========================================="
Write-Host ""
Write-Host "Record these in docs/ADDRESSES.md and strk20.json."
