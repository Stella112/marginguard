//! Domain-separated Poseidon commitments.
//!
//! STRK20 derives every hashed value under its own tag — `NOTE_ID_TAG`, `NULLIFIER_TAG`,
//! `ENC_AMOUNT_TAG`, and so on — so that a hash produced for one purpose can never be
//! replayed in another context. MarginGuard follows the same convention with its own tags.
//! This is threat T4 in the architecture report.
//!
//! These are *application* commitments. They are not STRK20 note commitments and are never
//! passed to the pool: the pool derives `note_id` and `nullifier` itself from channel keys
//! and viewing keys, which this contract neither sees nor needs.

use core::poseidon::poseidon_hash_span;

/// Binds side, price, size and a caller-chosen salt into a resting order.
pub const ORDER_COMMITMENT_TAG: felt252 = 'MG_ORDER_COMMIT:V1';

/// Binds a claimant to an order without revealing an address.
pub const TRADER_COMMITMENT_TAG: felt252 = 'MG_TRADER_COMMIT:V1';

/// Binds size, entry price, margin and leverage into a perpetual position.
pub const POSITION_COMMITMENT_TAG: felt252 = 'MG_POSITION_COMMIT:V1';

/// The message an agent signs when proposing a risk action.
pub const PROPOSAL_TAG: felt252 = 'MG_PROPOSAL:V1';

/// `poseidon(ORDER_COMMITMENT_TAG, side, price, size, salt)`.
///
/// The salt is what makes the commitment hiding: without it, the space of plausible
/// (side, price, size) triples is small enough to grind. Callers must draw it from a
/// cryptographic source — the frontend uses `starknet.js` randomness, never a timestamp.
pub fn compute_order_commitment(side: u8, price: u128, size: u128, salt: felt252) -> felt252 {
    poseidon_hash_span(
        [ORDER_COMMITMENT_TAG, side.into(), price.into(), size.into(), salt].span(),
    )
}

/// `poseidon(TRADER_COMMITMENT_TAG, owner_secret)`.
///
/// Stored on the order in place of an address. At claim time the claimant supplies the
/// preimage, exactly as the STRK20 escrow helper does — knowledge of the secret is the
/// entitlement, so the order never names a trader on-chain.
pub fn compute_trader_commitment(owner_secret: felt252) -> felt252 {
    poseidon_hash_span([TRADER_COMMITMENT_TAG, owner_secret].span())
}

/// `poseidon(POSITION_COMMITMENT_TAG, side, size, entry_price, margin, leverage, salt)`.
pub fn compute_position_commitment(
    side: u8, size: u128, entry_price: u128, margin: u128, leverage: u8, salt: felt252,
) -> felt252 {
    poseidon_hash_span(
        [
            POSITION_COMMITMENT_TAG,
            side.into(),
            size.into(),
            entry_price.into(),
            margin.into(),
            leverage.into(),
            salt,
        ]
            .span(),
    )
}

/// The digest an agent signs: `poseidon(PROPOSAL_TAG, position_id, kind, value, nonce)`.
///
/// The nonce is the agent's registry counter. Binding it into the digest is what stops a
/// once-valid proposal from being replayed later against the same position (threat T6).
pub fn compute_proposal_digest(
    position_id: felt252, kind: u8, value: u128, nonce: u64,
) -> felt252 {
    poseidon_hash_span(
        [PROPOSAL_TAG, position_id, kind.into(), value.into(), nonce.into()].span(),
    )
}
