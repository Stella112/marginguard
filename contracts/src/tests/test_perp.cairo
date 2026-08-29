//! Perp engine tests: lifecycle, PnL settlement, and oracle-driven liquidation.
//!
//! Deploys a settable mock oracle and the real perp engine, then drives positions through
//! open → (price moves) → close or liquidate. Numbers are chosen so the maintenance boundary
//! is exact and easy to check by hand.
//!
//! Fixture (a 2x long, unless noted):
//!   entry = 1500, size = 100 base  → entry value 150000 quote
//!   margin = 50000 quote           → maintenance = 25000 (50%)
//!   liquidatable when equity < 25000, i.e. loss > 25000, i.e. price < 1250.

use starknet::syscalls::deploy_syscall;
use starknet::{ContractAddress, SyscallResultTrait};

use crate::commitments::{compute_position_commitment, compute_trader_commitment};
use crate::perp::{IPerpEngineDispatcher, IPerpEngineDispatcherTrait, PerpEngine};
use crate::types::{SIDE_BUY, SIDE_SELL};
use super::mock_oracle::{IMockOracleDispatcher, MockOracle};

const SCALE: u128 = 1000000000000000000;
const ENTRY: u128 = 1500 * SCALE;
const SIZE: u128 = 100;
const MARGIN: u128 = 50000;
const LEV: u8 = 2;

const OWNER_SECRET: felt252 = 'perp_owner';
const SALT: felt252 = 'perp_salt';

fn base() -> ContractAddress {
    0xB45E.try_into().unwrap()
}
fn quote() -> ContractAddress {
    0x9074E.try_into().unwrap()
}

#[derive(Copy, Drop)]
struct World {
    oracle: IMockOracleDispatcher,
    perp: IPerpEngineDispatcher,
}

/// Deploys the mock oracle at `price` and a perp engine pointed at it.
fn setup(price: u128) -> World {
    let (oracle_addr, _) = deploy_syscall(
        MockOracle::TEST_CLASS_HASH.try_into().unwrap(), 0, array![price.into()].span(), false,
    )
        .unwrap_syscall();
    let (perp_addr, _) = deploy_syscall(
        PerpEngine::TEST_CLASS_HASH.try_into().unwrap(), 0, array![oracle_addr.into()].span(),
        false,
    )
        .unwrap_syscall();
    World {
        oracle: IMockOracleDispatcher { contract_address: oracle_addr },
        perp: IPerpEngineDispatcher { contract_address: perp_addr },
    }
}

/// Opens the fixture long under `id`.
fn open_long(w: World, id: felt252) {
    w
        .perp
        .open_position(
            id,
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
            base(),
            quote(),
        );
}

fn open_short(w: World, id: felt252) {
    w
        .perp
        .open_position(
            id,
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(SIDE_SELL, SIZE, ENTRY, MARGIN, LEV, SALT),
            base(),
            quote(),
        );
}

// ---------------------------------------------------------------------------
// Lifecycle and privacy.
// ---------------------------------------------------------------------------

#[test]
fn opening_leaves_only_public_state() {
    let w = setup(ENTRY);
    open_long(w, 'p1');

    let p = w.perp.get_position('p1');
    // Public: market, flags, and the commitment. Nothing about size/entry/margin/leverage.
    assert(p.commitment == compute_position_commitment(SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT), 'commit');
    assert(p.base_token == base() && p.quote_token == quote(), 'market public');
    assert(p.open, 'open');
    assert(!p.liquidated, 'not liquidated');
    assert(w.perp.is_open('p1'), 'is_open');
}

#[test]
#[should_panic(expected: ('POSITION_EXISTS', 'ENTRYPOINT_FAILED'))]
fn position_ids_cannot_be_reused() {
    let w = setup(ENTRY);
    open_long(w, 'p1');
    open_long(w, 'p1');
}

#[test]
#[should_panic(expected: ('SAME_TOKEN', 'ENTRYPOINT_FAILED'))]
fn base_and_quote_must_differ() {
    let w = setup(ENTRY);
    w
        .perp
        .open_position(
            'p1',
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
            base(),
            base(),
        );
}

#[test]
#[should_panic(expected: ('BAD_SIDE', 'ENTRYPOINT_FAILED'))]
fn an_invalid_side_cannot_be_used_for_a_close() {
    let w = setup(ENTRY);
    w
        .perp
        .open_position(
            'p1',
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(2, SIZE, ENTRY, MARGIN, LEV, 'invalid_side'),
            base(),
            quote(),
        );
    w.perp.close_position('p1', OWNER_SECRET, 2, SIZE, ENTRY, MARGIN, LEV, 'invalid_side');
}

#[test]
#[should_panic(expected: ('UNSUPPORTED_LEVERAGE', 'ENTRYPOINT_FAILED'))]
fn a_non_tier_leverage_cannot_be_used_for_a_close() {
    let w = setup(ENTRY);
    w
        .perp
        .open_position(
            'p1',
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(SIDE_BUY, SIZE, ENTRY, MARGIN, 3, 'invalid_leverage'),
            base(),
            quote(),
        );
    w.perp.close_position('p1', OWNER_SECRET, SIDE_BUY, SIZE, ENTRY, MARGIN, 3, 'invalid_leverage');
}

// ---------------------------------------------------------------------------
// Close settlement (PnL).
// ---------------------------------------------------------------------------

#[test]
fn closing_in_profit_settles_margin_plus_gain() {
    let w = setup(1600 * SCALE); // long up 100/unit on 100 units = +10000
    open_long(w, 'p1');

    w.perp.close_position('p1', OWNER_SECRET, SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);

    let (tok, amt) = w.perp.get_settlement('p1');
    assert(tok == quote(), 'quote settlement');
    assert(amt == 60000, 'margin 50000 + gain 10000');
    assert(!w.perp.is_open('p1'), 'closed');
}

#[test]
fn closing_in_loss_settles_margin_minus_loss() {
    let w = setup(1300 * SCALE); // long down 200/unit = -20000
    open_long(w, 'p1');

    w.perp.close_position('p1', OWNER_SECRET, SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);

    let (_, amt) = w.perp.get_settlement('p1');
    assert(amt == 30000, 'margin 50000 - loss 20000');
}

#[test]
fn a_short_profits_when_the_market_falls() {
    let w = setup(1400 * SCALE); // short, price down 100/unit = +10000
    open_short(w, 'p1');

    w.perp.close_position('p1', OWNER_SECRET, SIDE_SELL, SIZE, ENTRY, MARGIN, LEV, SALT);

    let (_, amt) = w.perp.get_settlement('p1');
    assert(amt == 60000, 'short gain 10000');
}

/// Entitlement is the secret. A stranger cannot close someone's position.
#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET', 'ENTRYPOINT_FAILED'))]
fn a_stranger_cannot_close() {
    let w = setup(ENTRY);
    open_long(w, 'p1');
    w.perp.close_position('p1', 'wrong', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);
}

/// A false reveal (lying about entry to inflate the payout) fails the commitment check.
#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH', 'ENTRYPOINT_FAILED'))]
fn a_false_reveal_cannot_close() {
    let w = setup(1600 * SCALE);
    open_long(w, 'p1');
    // Claim entry 1000 instead of the committed 1500 to fake a bigger gain.
    w.perp.close_position('p1', OWNER_SECRET, SIDE_BUY, SIZE, 1000 * SCALE, MARGIN, LEV, SALT);
}

// ---------------------------------------------------------------------------
// Liquidation.
// ---------------------------------------------------------------------------

#[test]
fn a_healthy_position_is_not_liquidatable() {
    let w = setup(ENTRY); // at entry, equity == margin, well above maintenance
    open_long(w, 'p1');
    assert(
        !w.perp.is_liquidatable('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
        'healthy',
    );
}

/// The maintenance boundary is exact: equity == maintenance is NOT a breach.
#[test]
fn the_maintenance_boundary_is_exclusive() {
    let w = setup(1250 * SCALE); // loss 25000, equity 25000 == maintenance 25000
    open_long(w, 'p1');
    assert(
        !w.perp.is_liquidatable('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
        'boundary not breached',
    );
}

#[test]
fn a_breach_below_maintenance_is_liquidatable() {
    let w = setup(1240 * SCALE); // loss 26000, equity 24000 < 25000
    open_long(w, 'p1');
    assert(
        w.perp.is_liquidatable('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
        'breached',
    );
}

#[test]
fn liquidation_closes_the_position_and_settles_residual() {
    let w = setup(1200 * SCALE); // loss 30000, equity 20000
    open_long(w, 'p1');

    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);

    let p = w.perp.get_position('p1');
    assert(!p.open, 'closed');
    assert(p.liquidated, 'flagged liquidated');
    let (_, residual) = w.perp.get_settlement('p1');
    assert(residual == 20000, 'residual equity to owner');
}

/// A loss beyond the whole margin leaves zero residual — never underflows.
#[test]
fn a_total_loss_settles_zero_residual() {
    let w = setup(1000 * SCALE); // loss 50000 == margin
    open_long(w, 'p1');
    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);
    let (_, residual) = w.perp.get_settlement('p1');
    assert(residual == 0, 'zero residual');
}

/// A healthy position cannot be liquidated even by revealing correct values.
#[test]
#[should_panic(expected: ('NOT_LIQUIDATABLE', 'ENTRYPOINT_FAILED'))]
fn a_healthy_position_cannot_be_liquidated() {
    let w = setup(ENTRY);
    open_long(w, 'p1');
    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);
}

/// A short is liquidated when the market rises far enough.
#[test]
fn a_short_is_liquidated_when_the_market_rises() {
    let w = setup(1800 * SCALE); // short loss 30000, equity 20000 < 25000
    open_short(w, 'p1');
    assert(
        w.perp.is_liquidatable('p1', SIDE_SELL, SIZE, ENTRY, MARGIN, LEV, SALT),
        'short breached',
    );
    w.perp.liquidate('p1', SIDE_SELL, SIZE, ENTRY, MARGIN, LEV, SALT);
    assert(!w.perp.is_open('p1'), 'short liquidated');
}

/// Liquidation is permissionless in authorization but still reveal-gated: false values are
/// rejected by the commitment check, so no one can fake a liquidation.
#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH', 'ENTRYPOINT_FAILED'))]
fn liquidation_with_false_values_is_rejected() {
    let w = setup(1200 * SCALE);
    open_long(w, 'p1');
    // Correct price breach, but lie about margin to change the maths.
    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, 999999, LEV, SALT);
}

#[test]
#[should_panic(expected: ('NOT_OPEN', 'ENTRYPOINT_FAILED'))]
fn a_closed_position_cannot_be_liquidated() {
    let w = setup(1200 * SCALE);
    open_long(w, 'p1');
    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);
    // Already liquidated → no longer open.
    w.perp.liquidate('p1', SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT);
}
