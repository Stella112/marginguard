//! PragmaOracle conversion test — verifies the real STRK/USDC scaling.
//!
//! Pragma STRK/USD = 2439000 at 8dp ($0.02439). For STRK(18)/USDC(6) the engine price is
//! pragma_price × 10^(18+6-18-8) = ×10^-2 = /100 = 24390. This matches the live market and is
//! ~3.15x below the stale Ekubo oracle-extension value (~76889) that motivated the switch.

use starknet::syscalls::deploy_syscall;
use starknet::{ContractAddress, SyscallResultTrait};
use crate::oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
use crate::oracle_pragma::PragmaOracle;
use super::mock_pragma::MockPragma;

fn tok(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

/// Mock Pragma at (price, decimals), and the adapter for STRK(18)/USDC(6) over it.
fn setup(price: u128, decimals: u32) -> IPriceOracleDispatcher {
    let (pragma, _) = deploy_syscall(
        MockPragma::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![price.into(), decimals.into()].span(),
        false,
    )
        .unwrap_syscall();
    // constructor(pragma, pair_id='STRK/USD', base_decimals=18, quote_decimals=6)
    let (adapter, _) = deploy_syscall(
        PragmaOracle::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![pragma.into(), 'STRK/USD', 18_u8.into(), 6_u8.into()].span(),
        false,
    )
        .unwrap_syscall();
    IPriceOracleDispatcher { contract_address: adapter }
}

#[test]
fn strk_usd_converts_to_engine_scale() {
    // $0.02439 at 8dp -> 24390 in the engine's units.
    let oracle = setup(2439000, 8);
    assert(oracle.get_price(tok(0x1), tok(0x2)) == 24390, 'strk 0.02439 -> 24390');
}

#[test]
fn a_dollar_converts_to_one_million() {
    // $1.00 at 8dp (100000000) -> engine price 1e6 (1 USDC-smallest-per-STRK-smallest * 1e18
    // in the /100 scale = 1000000).
    let oracle = setup(100000000, 8);
    assert(oracle.get_price(tok(0x1), tok(0x2)) == 1000000, 'one dollar -> 1e6');
}

#[test]
fn handles_a_positive_exponent_pair() {
    // If pragma decimals were small (say 4), exponent = 18+6-18-4 = +2, multiply by 100.
    // $0.02439 at 4dp = 244 -> 244 * 100 = 24400 (rounding to 4dp input).
    let oracle = setup(244, 4);
    assert(oracle.get_price(tok(0x1), tok(0x2)) == 24400, 'positive exp path');
}

#[test]
#[should_panic(expected: ('STALE_OR_EMPTY', 'ENTRYPOINT_FAILED'))]
fn rejects_a_zero_price() {
    let oracle = setup(0, 8);
    oracle.get_price(tok(0x1), tok(0x2));
}
