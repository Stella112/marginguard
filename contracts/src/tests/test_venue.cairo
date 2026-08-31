//! Venue integration tests.
//!
//! Unlike the other suites, these deploy the real contracts — a mock ERC-20, the order book,
//! and the venue — and drive the full fund → place → match → claim path through dispatchers.
//! The venue makes real cross-contract calls (to the book and to tokens), so mocking those
//! away would test nothing; deploying is both necessary and a stronger check.
//!
//! Simulating the pool: the venue asserts `get_caller_address() == pool`. In cairo-test, the
//! caller a deployed contract sees is the test's current contract address, so
//! `set_contract_address(pool())` immediately before a `privacy_invoke` call makes the venue
//! see the pool as caller. Funds the pool would have withdrawn are staged by minting straight
//! to the venue.
//!
//! Known limitation exercised here: the buy-side reserve is sized at the buyer's limit price,
//! and price-improvement surplus (limit better than the midpoint fill) is not auto-refunded in
//! this version. The surplus stays in the venue with its credit released, never double-promised
//! — see `buy_side_price_improvement_surplus_stays_solvent`. Documented in SECURITY_ASSUMPTIONS.

use starknet::syscalls::deploy_syscall;
use starknet::testing::set_contract_address;
use starknet::{ContractAddress, SyscallResultTrait};

use crate::commitments::{compute_order_commitment, compute_trader_commitment};
use crate::order_book::{IOrderBookDispatcher, IOrderBookDispatcherTrait};
use crate::types::{SIDE_BUY, SIDE_SELL};
use crate::venue::{
    IMarginGuardVenueDispatcher, IMarginGuardVenueDispatcherTrait, VenueOperation,
};
use super::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait, MockErc20};
use crate::order_book::OrderBook;
use crate::venue::MarginGuardVenue;

fn pool() -> ContractAddress {
    0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a.try_into().unwrap()
}

const BUYER_SECRET: felt252 = 'buyer_secret';
const SELLER_SECRET: felt252 = 'seller_secret';
const BUY_SALT: felt252 = 'buy_salt';
const SELL_SALT: felt252 = 'sell_salt';

// Prices are scaled by PRICE_SCALE (1e18): quote units per one whole base unit.
const SCALE: u128 = 1000000000000000000;
const BUY_PRICE: u128 = 1600 * SCALE;
const SELL_PRICE: u128 = 1400 * SCALE;
const SIZE: u128 = 100;

// Reserves: the buyer locks quote at their limit (100 * 1600), the seller locks 100 base.
const BUY_RESERVE_QUOTE: u128 = 160000;
const SELL_RESERVE_BASE: u128 = 100;
// Payouts at the 1500 midpoint: buyer receives 100 base, seller receives 100 * 1500 quote.
const BUYER_PAYOUT_BASE: u128 = 100;
const SELLER_PAYOUT_QUOTE: u128 = 150000;

#[derive(Copy, Drop)]
struct World {
    base: IMockErc20Dispatcher,
    quote: IMockErc20Dispatcher,
    book: IOrderBookDispatcher,
    venue: IMarginGuardVenueDispatcher,
    venue_addr: ContractAddress,
}

fn deploy_token(salt: felt252) -> IMockErc20Dispatcher {
    let (addr, _) = deploy_syscall(
        MockErc20::TEST_CLASS_HASH.try_into().unwrap(), salt, array![].span(), false,
    )
        .unwrap_syscall();
    IMockErc20Dispatcher { contract_address: addr }
}

/// Deploys token pair, book and venue, and binds the book to the venue.
fn setup() -> World {
    let base = deploy_token('base');
    let quote = deploy_token('quote');

    let (book_addr, _) = deploy_syscall(
        OrderBook::TEST_CLASS_HASH.try_into().unwrap(), 0, array![].span(), false,
    )
        .unwrap_syscall();

    let (venue_addr, _) = deploy_syscall(
        MarginGuardVenue::TEST_CLASS_HASH.try_into().unwrap(),
        0,
        array![pool().into(), book_addr.into()].span(),
        false,
    )
        .unwrap_syscall();

    let book = IOrderBookDispatcher { contract_address: book_addr };
    book.initialize_venue(venue_addr);

    World {
        base,
        quote,
        book,
        venue: IMarginGuardVenueDispatcher { contract_address: venue_addr },
        venue_addr,
    }
}

/// Simulates the pool withdrawing `amount` of `token` to the venue, then driving a Fund invoke.
fn fund(w: World, token: IMockErc20Dispatcher, trader_commitment: felt252, amount: u128) {
    token.mint(w.venue_addr, amount.into());
    set_contract_address(pool());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Fund, trader_commitment, token.contract_address, amount, 0, 0, 0, 0,
            0, 0, 0,
        );
    set_contract_address(0.try_into().unwrap());
}

/// Drives a Claim invoke as the pool and returns nothing — assertions read allowances after.
fn claim(
    w: World,
    owner_secret: felt252,
    order_id: felt252,
    side: u8,
    price: u128,
    size: u128,
    salt: felt252,
    note_id: felt252,
) {
    set_contract_address(pool());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Claim, 0, 0.try_into().unwrap(), 0, owner_secret, order_id, side,
            price, size, salt, note_id,
        );
    set_contract_address(0.try_into().unwrap());
}

/// Funds both sides and places both orders, leaving them live and backed.
fn fund_and_place(w: World) {
    let buyer = compute_trader_commitment(BUYER_SECRET);
    let seller = compute_trader_commitment(SELLER_SECRET);

    fund(w, w.quote, buyer, BUY_RESERVE_QUOTE);
    fund(w, w.base, seller, SELL_RESERVE_BASE);

    w
        .venue
        .place_order(
            'buy1',
            buyer,
            compute_order_commitment(SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT),
            w.base.contract_address,
            w.quote.contract_address,
            w.quote.contract_address,
            BUY_RESERVE_QUOTE,
        );

    w
        .venue
        .place_order(
            'sell1',
            seller,
            compute_order_commitment(SIDE_SELL, SELL_PRICE, SIZE, SELL_SALT),
            w.base.contract_address,
            w.quote.contract_address,
            w.base.contract_address,
            SELL_RESERVE_BASE,
        );
}

// ---------------------------------------------------------------------------
// The happy path, end to end.
// ---------------------------------------------------------------------------

#[test]
fn funding_credits_a_balance_keyed_by_commitment() {
    let w = setup();
    let buyer = compute_trader_commitment(BUYER_SECRET);

    fund(w, w.quote, buyer, BUY_RESERVE_QUOTE);

    assert(
        w.venue.balance_of(buyer, w.quote.contract_address) == BUY_RESERVE_QUOTE,
        'balance credited',
    );
}

#[test]
fn placement_moves_the_reserve_out_of_the_spendable_balance() {
    let w = setup();
    fund_and_place(w);

    let buyer = compute_trader_commitment(BUYER_SECRET);
    // The whole balance was reserved, so nothing spendable remains.
    assert(w.venue.balance_of(buyer, w.quote.contract_address) == 0, 'reserve moved out');

    let (rtok, ramt) = w.venue.reserved_of('buy1');
    assert(rtok == w.quote.contract_address, 'reserved token');
    assert(ramt == BUY_RESERVE_QUOTE, 'reserved amount');

    // And the order is really live in the book.
    assert(w.book.is_live('buy1'), 'order live');
}

#[test]
fn both_sides_claim_their_leg_after_a_match() {
    let w = setup();
    fund_and_place(w);

    // Permissionless match at the 1500 midpoint.
    w
        .book
        .match_orders(
            'buy1', BUY_PRICE, SIZE, BUY_SALT, 'sell1', SELL_PRICE, SIZE, SELL_SALT,
        );

    // Buyer claims base; venue approves the pool to pull exactly the filled base size.
    claim(w, BUYER_SECRET, 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
    assert(
        w.base.allowance(w.venue_addr, pool()) == BUYER_PAYOUT_BASE.into(),
        'buyer paid in base',
    );
    assert(w.venue.is_claimed('buy1'), 'buy claimed');

    // Seller claims quote at the midpoint value.
    claim(w, SELLER_SECRET, 'sell1', SIDE_SELL, SELL_PRICE, SIZE, SELL_SALT, 'note_sell');
    assert(
        w.quote.allowance(w.venue_addr, pool()) == SELLER_PAYOUT_QUOTE.into(),
        'seller paid in quote',
    );
    assert(w.venue.is_claimed('sell1'), 'sell claimed');
}

/// The venue always holds at least what it has approved out, including the unrefunded buy-side
/// price-improvement surplus (10000 quote here: reserved at 1600, filled at 1500).
#[test]
fn buy_side_price_improvement_surplus_stays_solvent() {
    let w = setup();
    fund_and_place(w);
    w
        .book
        .match_orders(
            'buy1', BUY_PRICE, SIZE, BUY_SALT, 'sell1', SELL_PRICE, SIZE, SELL_SALT,
        );
    claim(w, BUYER_SECRET, 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
    claim(w, SELLER_SECRET, 'sell1', SIDE_SELL, SELL_PRICE, SIZE, SELL_SALT, 'note_sell');

    // Venue held 160000 quote, approved 150000 out: 10000 surplus remains, solvent.
    assert(
        w.quote.balance_of(w.venue_addr) >= w.quote.allowance(w.venue_addr, pool()),
        'venue stays solvent',
    );
}

// ---------------------------------------------------------------------------
// Access control and accounting.
// ---------------------------------------------------------------------------

/// Threat T1. Only the pinned pool may drive privacy_invoke.
#[test]
#[should_panic(expected: ('CALLER_NOT_PRIVACY', 'ENTRYPOINT_FAILED'))]
fn a_non_pool_caller_cannot_invoke() {
    let w = setup();
    set_contract_address(0xDEAD.try_into().unwrap());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Fund, compute_trader_commitment(BUYER_SECRET),
            w.quote.contract_address, 100, 0, 0, 0, 0, 0, 0, 0,
        );
}

/// A Fund claiming more than the venue actually received is refused, so credit can never
/// exceed the tokens on hand.
#[test]
#[should_panic(expected: ('UNDERFUNDED', 'ENTRYPOINT_FAILED'))]
fn funding_beyond_the_real_balance_is_refused() {
    let w = setup();
    let buyer = compute_trader_commitment(BUYER_SECRET);
    // Mint only half of what the invoke will claim.
    w.quote.mint(w.venue_addr, 50);
    set_contract_address(pool());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Fund, buyer, w.quote.contract_address, 100, 0, 0, 0, 0, 0, 0, 0,
        );
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn placing_beyond_the_funded_balance_is_refused() {
    let w = setup();
    let buyer = compute_trader_commitment(BUYER_SECRET);
    fund(w, w.quote, buyer, 1000);

    w
        .venue
        .place_order(
            'buy1',
            buyer,
            compute_order_commitment(SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT),
            w.base.contract_address,
            w.quote.contract_address,
            w.quote.contract_address,
            5000 // more than the 1000 funded
        );
}

// ---------------------------------------------------------------------------
// Claim guards.
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: ('NOT_MATCHED', 'ENTRYPOINT_FAILED'))]
fn an_unmatched_order_cannot_be_claimed() {
    let w = setup();
    fund_and_place(w);
    claim(w, BUYER_SECRET, 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
}

#[test]
#[should_panic(expected: ('ALREADY_CLAIMED', 'ENTRYPOINT_FAILED'))]
fn a_leg_cannot_be_claimed_twice() {
    let w = setup();
    fund_and_place(w);
    w
        .book
        .match_orders(
            'buy1', BUY_PRICE, SIZE, BUY_SALT, 'sell1', SELL_PRICE, SIZE, SELL_SALT,
        );
    claim(w, BUYER_SECRET, 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
    claim(w, BUYER_SECRET, 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
}

/// Entitlement is the secret, not an address: a wrong secret cannot claim (threat T2).
#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET', 'ENTRYPOINT_FAILED'))]
fn a_wrong_secret_cannot_claim() {
    let w = setup();
    fund_and_place(w);
    w
        .book
        .match_orders(
            'buy1', BUY_PRICE, SIZE, BUY_SALT, 'sell1', SELL_PRICE, SIZE, SELL_SALT,
        );
    claim(w, 'not_the_secret', 'buy1', SIDE_BUY, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
}

/// Threat T3, at the claim leg. Lying about the side to grab the more valuable token fails,
/// because the venue re-derives the order commitment from the revealed values first.
#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH', 'ENTRYPOINT_FAILED'))]
fn a_false_side_reveal_cannot_claim_the_wrong_token() {
    let w = setup();
    fund_and_place(w);
    w
        .book
        .match_orders(
            'buy1', BUY_PRICE, SIZE, BUY_SALT, 'sell1', SELL_PRICE, SIZE, SELL_SALT,
        );
    // The buy order was committed as SIDE_BUY; claiming it as SIDE_SELL breaks the commitment.
    claim(w, BUYER_SECRET, 'buy1', SIDE_SELL, BUY_PRICE, SIZE, BUY_SALT, 'note_buy');
}

// ─── Withdraw and Cancel ───────────────────────────────────────────────────────
//
// Before these existed the venue was a one-way door: funds entered on Fund and left only
// on Claim, which needs a matched order. An order that never found a counterparty trapped
// its reserve permanently, with no path out for anyone.

/// Drives a Withdraw invoke as the pool.
fn withdraw(
    w: World, owner_secret: felt252, token: IMockErc20Dispatcher, amount: u128, note_id: felt252,
) {
    set_contract_address(pool());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Withdraw, 0, token.contract_address, amount, owner_secret, 0, 0, 0,
            0, 0, note_id,
        );
    set_contract_address(0.try_into().unwrap());
}

/// Drives a Cancel invoke as the pool.
fn cancel(w: World, owner_secret: felt252, order_id: felt252) {
    set_contract_address(pool());
    w
        .venue
        .privacy_invoke(
            VenueOperation::Cancel, 0, 0.try_into().unwrap(), 0, owner_secret, order_id, 0, 0,
            0, 0, 0,
        );
    set_contract_address(0.try_into().unwrap());
}

#[test]
fn a_free_balance_can_be_withdrawn() {
    let w = setup();
    let seller = compute_trader_commitment(SELLER_SECRET);
    fund(w, w.base, seller, SELL_RESERVE_BASE);
    assert(w.venue.balance_of(seller, w.base.contract_address) == SELL_RESERVE_BASE, 'funded');

    withdraw(w, SELLER_SECRET, w.base, SELL_RESERVE_BASE, 'note1');

    assert(w.venue.balance_of(seller, w.base.contract_address) == 0, 'balance drained');
    // Approve, never transfer: the pool pulls the funds itself.
    assert(
        w.base.allowance(w.venue_addr, pool()) == SELL_RESERVE_BASE.into(), 'pool approved',
    );
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn withdrawing_more_than_the_balance_is_refused() {
    let w = setup();
    fund(w, w.base, compute_trader_commitment(SELLER_SECRET), SELL_RESERVE_BASE);
    withdraw(w, SELLER_SECRET, w.base, SELL_RESERVE_BASE + 1, 'note1');
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn a_wrong_secret_cannot_withdraw() {
    let w = setup();
    fund(w, w.base, compute_trader_commitment(SELLER_SECRET), SELL_RESERVE_BASE);
    // Entitlement is the secret: a different one derives a different commitment, whose
    // balance is zero.
    withdraw(w, BUYER_SECRET, w.base, SELL_RESERVE_BASE, 'note1');
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_BALANCE', 'ENTRYPOINT_FAILED'))]
fn a_live_order_s_reserve_cannot_be_withdrawn() {
    let w = setup();
    fund_and_place(w);
    // The reserve is held against the order, not sitting in the free balance.
    withdraw(w, SELLER_SECRET, w.base, SELL_RESERVE_BASE, 'note1');
}

#[test]
fn cancelling_releases_the_reserve_and_it_can_then_be_withdrawn() {
    let w = setup();
    fund_and_place(w);
    let seller = compute_trader_commitment(SELLER_SECRET);
    assert(w.venue.balance_of(seller, w.base.contract_address) == 0, 'all reserved');

    cancel(w, SELLER_SECRET, 'sell1');

    assert(!w.book.is_live('sell1'), 'no longer live');
    assert(
        w.venue.balance_of(seller, w.base.contract_address) == SELL_RESERVE_BASE, 'released',
    );

    withdraw(w, SELLER_SECRET, w.base, SELL_RESERVE_BASE, 'note1');
    assert(w.venue.balance_of(seller, w.base.contract_address) == 0, 'withdrawn');
    assert(w.base.allowance(w.venue_addr, pool()) == SELL_RESERVE_BASE.into(), 'approved');
}

#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn a_wrong_secret_cannot_cancel() {
    let w = setup();
    fund_and_place(w);
    cancel(w, BUYER_SECRET, 'sell1');
}

#[test]
#[should_panic(expected: ('NOT_LIVE', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn an_order_cannot_be_cancelled_twice() {
    let w = setup();
    fund_and_place(w);
    cancel(w, SELLER_SECRET, 'sell1');
    cancel(w, SELLER_SECRET, 'sell1');
}
