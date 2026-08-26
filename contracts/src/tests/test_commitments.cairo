use crate::commitments::{
    compute_order_commitment, compute_position_commitment, compute_proposal_digest,
    compute_trader_commitment,
};
use crate::types::{SIDE_BUY, SIDE_SELL};

#[test]
fn order_commitment_is_deterministic() {
    let a = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    let b = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    assert(a == b, 'same inputs, same commitment');
}

#[test]
fn order_commitment_binds_side() {
    let buy = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    let sell = compute_order_commitment(SIDE_SELL, 1500, 100, 'salt');
    assert(buy != sell, 'side must be bound');
}

#[test]
fn order_commitment_binds_price() {
    let a = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    let b = compute_order_commitment(SIDE_BUY, 1501, 100, 'salt');
    assert(a != b, 'price must be bound');
}

#[test]
fn order_commitment_binds_size() {
    let a = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    let b = compute_order_commitment(SIDE_BUY, 1500, 101, 'salt');
    assert(a != b, 'size must be bound');
}

/// The salt is what makes the commitment hiding: identical orders from different traders
/// must not produce the same on-chain value, or the book would leak by equality alone.
#[test]
fn order_commitment_binds_salt() {
    let a = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt_a');
    let b = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt_b');
    assert(a != b, 'salt must be bound');
}

/// Domain separation: an order commitment and a position commitment over comparable inputs
/// must not collide, or a hash minted in one context could be replayed in the other (T4).
#[test]
fn tags_separate_domains() {
    let order = compute_order_commitment(SIDE_BUY, 1500, 100, 'salt');
    let trader = compute_trader_commitment('salt');
    let position = compute_position_commitment(SIDE_BUY, 100, 1500, 50, 2, 'salt');
    let proposal = compute_proposal_digest('pos', 0, 100, 0);

    assert(order != trader, 'order vs trader');
    assert(order != position, 'order vs position');
    assert(order != proposal, 'order vs proposal');
    assert(trader != position, 'trader vs position');
    assert(trader != proposal, 'trader vs proposal');
    assert(position != proposal, 'position vs proposal');
}

#[test]
fn trader_commitment_is_deterministic() {
    assert(
        compute_trader_commitment('secret') == compute_trader_commitment('secret'),
        'same secret, same commitment',
    );
    assert(
        compute_trader_commitment('secret_a') != compute_trader_commitment('secret_b'),
        'different secrets differ',
    );
}

/// The nonce is the replay defence (T6). A proposal identical in every other respect must
/// produce a different digest once the nonce moves, so an old signature cannot be reused.
#[test]
fn proposal_digest_binds_nonce() {
    let a = compute_proposal_digest('pos', 0, 500, 0);
    let b = compute_proposal_digest('pos', 0, 500, 1);
    assert(a != b, 'nonce must be bound');
}

#[test]
fn proposal_digest_binds_kind_and_value() {
    let base = compute_proposal_digest('pos', 0, 500, 7);
    assert(base != compute_proposal_digest('pos', 1, 500, 7), 'kind must be bound');
    assert(base != compute_proposal_digest('pos', 0, 501, 7), 'value must be bound');
    assert(base != compute_proposal_digest('other', 0, 500, 7), 'position must be bound');
}

#[test]
fn position_commitment_binds_every_field() {
    let base = compute_position_commitment(SIDE_BUY, 100, 1500, 50, 2, 'salt');
    assert(base != compute_position_commitment(SIDE_SELL, 100, 1500, 50, 2, 'salt'), 'side');
    assert(base != compute_position_commitment(SIDE_BUY, 101, 1500, 50, 2, 'salt'), 'size');
    assert(base != compute_position_commitment(SIDE_BUY, 100, 1501, 50, 2, 'salt'), 'entry');
    assert(base != compute_position_commitment(SIDE_BUY, 100, 1500, 51, 2, 'salt'), 'margin');
    assert(base != compute_position_commitment(SIDE_BUY, 100, 1500, 50, 5, 'salt'), 'leverage');
    assert(base != compute_position_commitment(SIDE_BUY, 100, 1500, 50, 2, 'other'), 'salt');
}
