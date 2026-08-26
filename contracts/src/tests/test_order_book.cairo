use starknet::ContractAddress;
use crate::commitments::{compute_order_commitment, compute_trader_commitment};
use crate::order_book::OrderBook;
use crate::order_book::OrderBook::OrderBookImpl;
use crate::types::{SIDE_BUY, SIDE_SELL};

fn state() -> OrderBook::ContractState {
    OrderBook::contract_state_for_testing()
}

fn base() -> ContractAddress {
    0x111.try_into().unwrap()
}

fn quote() -> ContractAddress {
    0x222.try_into().unwrap()
}

const BUY_SECRET: felt252 = 'buyer_secret';
const SELL_SECRET: felt252 = 'seller_secret';
const BUY_SALT: felt252 = 'buy_salt';
const SELL_SALT: felt252 = 'sell_salt';

/// Places a buy at `price` for `size`, returning the order id.
fn place_buy(
    ref s: OrderBook::ContractState, order_id: felt252, price: u128, size: u128,
) -> felt252 {
    OrderBookImpl::place_order(
        ref s,
        order_id,
        compute_trader_commitment(BUY_SECRET),
        compute_order_commitment(SIDE_BUY, price, size, BUY_SALT),
        base(),
        quote(),
    );
    order_id
}

fn place_sell(
    ref s: OrderBook::ContractState, order_id: felt252, price: u128, size: u128,
) -> felt252 {
    OrderBookImpl::place_order(
        ref s,
        order_id,
        compute_trader_commitment(SELL_SECRET),
        compute_order_commitment(SIDE_SELL, price, size, SELL_SALT),
        base(),
        quote(),
    );
    order_id
}

#[test]
fn placed_order_is_live_and_unmatched() {
    let mut s = state();
    place_buy(ref s, 'o1', 1500, 100);

    assert(OrderBookImpl::is_live(@s, 'o1'), 'should be live');
    assert(!OrderBookImpl::is_matched(@s, 'o1'), 'should be unmatched');
}

/// The privacy claim, asserted directly: nothing recoverable from public order state reveals
/// price or size. Only the commitment, the pair, and the flags are stored.
#[test]
fn public_order_state_leaks_neither_price_nor_size() {
    let mut s = state();
    place_buy(ref s, 'o1', 1500, 100);

    let entry = OrderBookImpl::get_order(@s, 'o1');
    assert(entry.commitment == compute_order_commitment(SIDE_BUY, 1500, 100, BUY_SALT), 'commit');
    assert(entry.base_token == base(), 'base token public');
    assert(entry.quote_token == quote(), 'quote token public');

    // An unmatched order has no recorded fill, so not even the execution leaks early.
    let (fill_price, fill_size) = OrderBookImpl::get_fill(@s, 'o1');
    assert(fill_price == 0, 'no price before match');
    assert(fill_size == 0, 'no size before match');
}

#[test]
fn crossing_orders_match_at_midpoint() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);

    OrderBookImpl::match_orders(
        ref s, 'b1', 1600, 100, BUY_SALT, 's1', 1400, 100, SELL_SALT,
    );

    assert(OrderBookImpl::is_matched(@s, 'b1'), 'buy matched');
    assert(OrderBookImpl::is_matched(@s, 's1'), 'sell matched');
    assert(!OrderBookImpl::is_live(@s, 'b1'), 'buy no longer live');
    assert(!OrderBookImpl::is_live(@s, 's1'), 'sell no longer live');

    let (price, size) = OrderBookImpl::get_fill(@s, 'b1');
    assert(price == 1500, 'midpoint of 1600 and 1400');
    assert(size == 100, 'full fill');
}

/// Fill size is the smaller of the two orders, so neither side is over-filled.
#[test]
fn fill_size_is_the_minimum_of_both_sides() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 60);
    place_sell(ref s, 's1', 1400, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1600, 60, BUY_SALT, 's1', 1400, 100, SELL_SALT);

    let (_, size) = OrderBookImpl::get_fill(@s, 'b1');
    assert(size == 60, 'min of 60 and 100');
}

/// Threat T3: a match that lies about the revealed price must be rejected, because the
/// contract re-derives the commitment before trusting anything.
#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH',))]
fn false_price_reveal_is_rejected() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);

    // Claim the buyer bid 1450 rather than the committed 1600, to shift the midpoint.
    OrderBookImpl::match_orders(
        ref s, 'b1', 1450, 100, BUY_SALT, 's1', 1400, 100, SELL_SALT,
    );
}

#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH',))]
fn false_size_reveal_is_rejected() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1600, 999, BUY_SALT, 's1', 1400, 100, SELL_SALT);
}

/// A sell order cannot be passed off as the buy leg: the side is bound into the commitment,
/// and `match_orders` derives the buy leg with SIDE_BUY specifically.
#[test]
#[should_panic(expected: ('COMMITMENT_MISMATCH',))]
fn a_sell_cannot_be_matched_as_a_buy() {
    let mut s = state();
    place_sell(ref s, 's1', 1400, 100);
    place_sell(ref s, 's2', 1400, 100);

    OrderBookImpl::match_orders(ref s, 's1', 1400, 100, SELL_SALT, 's2', 1400, 100, SELL_SALT);
}

#[test]
#[should_panic(expected: ('NOT_CROSSING',))]
fn non_crossing_orders_do_not_match() {
    let mut s = state();
    place_buy(ref s, 'b1', 1400, 100);
    place_sell(ref s, 's1', 1600, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1400, 100, BUY_SALT, 's1', 1600, 100, SELL_SALT);
}

/// Touching prices are a valid cross: bid >= ask, so bid == ask matches at that price.
#[test]
fn touching_prices_match() {
    let mut s = state();
    place_buy(ref s, 'b1', 1500, 100);
    place_sell(ref s, 's1', 1500, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1500, 100, BUY_SALT, 's1', 1500, 100, SELL_SALT);

    let (price, _) = OrderBookImpl::get_fill(@s, 'b1');
    assert(price == 1500, 'midpoint of equal prices');
}

#[test]
#[should_panic(expected: ('ALREADY_MATCHED',))]
fn an_order_cannot_be_matched_twice() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);
    place_sell(ref s, 's2', 1400, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1600, 100, BUY_SALT, 's1', 1400, 100, SELL_SALT);
    OrderBookImpl::match_orders(ref s, 'b1', 1600, 100, BUY_SALT, 's2', 1400, 100, SELL_SALT);
}

#[test]
#[should_panic(expected: ('SELF_MATCH',))]
fn an_order_cannot_match_itself() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);

    OrderBookImpl::match_orders(ref s, 'b1', 1600, 100, BUY_SALT, 'b1', 1600, 100, BUY_SALT);
}

#[test]
#[should_panic(expected: ('ORDER_EXISTS',))]
fn order_ids_cannot_be_reused() {
    let mut s = state();
    place_buy(ref s, 'o1', 1500, 100);
    place_buy(ref s, 'o1', 1600, 200);
}

#[test]
fn owner_can_cancel_a_live_order() {
    let mut s = state();
    place_buy(ref s, 'o1', 1500, 100);

    OrderBookImpl::cancel_order(ref s, 'o1', BUY_SECRET);
    assert(!OrderBookImpl::is_live(@s, 'o1'), 'cancelled');
}

/// Entitlement is knowledge of the secret, not an address — so a wrong secret cannot cancel.
#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET',))]
fn a_stranger_cannot_cancel() {
    let mut s = state();
    place_buy(ref s, 'o1', 1500, 100);

    OrderBookImpl::cancel_order(ref s, 'o1', 'wrong_secret');
}

#[test]
#[should_panic(expected: ('ALREADY_MATCHED',))]
fn a_matched_order_cannot_be_cancelled() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);
    OrderBookImpl::match_orders(ref s, 'b1', 1600, 100, BUY_SALT, 's1', 1400, 100, SELL_SALT);

    OrderBookImpl::cancel_order(ref s, 'b1', BUY_SECRET);
}

#[test]
#[should_panic(expected: ('NOT_LIVE',))]
fn a_cancelled_order_cannot_be_matched() {
    let mut s = state();
    place_buy(ref s, 'b1', 1600, 100);
    place_sell(ref s, 's1', 1400, 100);
    OrderBookImpl::cancel_order(ref s, 'b1', BUY_SECRET);

    OrderBookImpl::match_orders(ref s, 'b1', 1600, 100, BUY_SALT, 's1', 1400, 100, SELL_SALT);
}

#[test]
#[should_panic(expected: ('SAME_TOKEN',))]
fn base_and_quote_must_differ() {
    let mut s = state();
    OrderBookImpl::place_order(
        ref s,
        'o1',
        compute_trader_commitment(BUY_SECRET),
        compute_order_commitment(SIDE_BUY, 1500, 100, BUY_SALT),
        base(),
        base(),
    );
}
