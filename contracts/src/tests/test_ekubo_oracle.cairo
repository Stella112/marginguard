//! EkuboTwapOracle conversion test.
//!
//! Deploys a mock Ekubo oracle returning a fixed Q128 price and the adapter over it, then checks
//! the adapter converts x128 → the engine's 1e18 scale correctly. The fixture uses the real
//! mainnet STRK/USDC TWAP value observed at build time (~0.0808 USDC/STRK).

use starknet::syscalls::deploy_syscall;
use starknet::{ContractAddress, SyscallResultTrait};
use crate::oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
use crate::oracle_ekubo::EkuboTwapOracle;
use super::mock_ekubo::MockEkuboOracle;

const TWO_128: u256 = 0x100000000000000000000000000000000;

fn tok(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

/// Deploys a mock Ekubo oracle returning `x128`, and the adapter reading it.
fn setup(x128: u256) -> IPriceOracleDispatcher {
    let (ekubo, _) = deploy_syscall(
        MockEkuboOracle::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![x128.low.into(), x128.high.into()].span(),
        false,
    )
        .unwrap_syscall();
    let (adapter, _) = deploy_syscall(
        EkuboTwapOracle::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![ekubo.into(), 1800_u64.into()].span(),
        false,
    )
        .unwrap_syscall();
    IPriceOracleDispatcher { contract_address: adapter }
}

#[test]
fn converts_a_unit_price_to_one_e18() {
    // x128 = 1 * 2^128 → price_1e18 should be exactly 1e18.
    let oracle = setup(TWO_128);
    assert(oracle.get_price(tok(0x1), tok(0x2)) == 1000000000000000000, 'unit price -> 1e18');
}

#[test]
fn converts_a_half_price() {
    // x128 = 0.5 * 2^128 → 5e17.
    let oracle = setup(TWO_128 / 2);
    assert(oracle.get_price(tok(0x1), tok(0x2)) == 500000000000000000, 'half -> 5e17');
}

#[test]
fn matches_the_live_strk_usdc_twap() {
    // Live mainnet STRK/USDC: raw smallest-unit price ~ 0.0808e-12 (STRK 18dp, USDC 6dp).
    // Its x128 ~ 0.0808e-12 * 2^128. Scaled to 1e18: ~ 0.0808e-12 * 1e18 = ~80,800.
    // Build x128 for raw = 808 / 1e16 (i.e. 0.0000000000000808) as an exact fraction.
    let x128: u256 = (TWO_128 * 808) / 10000000000000000;
    let oracle = setup(x128);
    let p = oracle.get_price(tok(0x1), tok(0x2));
    // Expect ~ 80800 (± rounding). Assert it lands in a tight band.
    assert(p > 80000 && p < 81600, 'strk/usdc ~ 80800');
}

#[test]
#[should_panic(expected: ('ZERO_ORACLE', 'CONSTRUCTOR_FAILED'))]
fn rejects_a_zero_ekubo_address() {
    let _ = deploy_syscall(
        EkuboTwapOracle::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![0.into(), 1800_u64.into()].span(),
        false,
    )
        .unwrap_syscall();
}
