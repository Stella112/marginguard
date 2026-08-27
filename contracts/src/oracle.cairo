//! Price oracle interface for the perp engine.
//!
//! The engine reads a price for a (base, quote) market to value positions, check margin health,
//! and gate liquidations. Decision Q3 in the architecture report selected an Ekubo **TWAP** read
//! over spot, because a single-block spot push could otherwise trigger false liquidations.
//!
//! This module defines only the interface MarginGuard depends on. Two implementations exist:
//!   * `MockOracle` (in tests) — a settable price, for exercising the engine deterministically.
//!   * an Ekubo TWAP adapter — the mainnet implementation, and the one remaining external
//!     integration whose live interface is still to be verified (see ADDRESSES.md).
//!
//! Keeping the engine behind this interface means the Ekubo specifics never leak into the
//! engine's logic, and the adapter can be swapped or re-pointed without touching position math.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IPriceOracle<T> {
    /// Price of one whole `base` unit expressed in `quote`, scaled by `PRICE_SCALE` (1e18).
    ///
    /// Implementations must return a time-weighted figure, not an instantaneous spot read.
    fn get_price(self: @T, base: ContractAddress, quote: ContractAddress) -> u128;
}
