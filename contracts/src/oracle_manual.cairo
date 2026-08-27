//! ManualOracle — a deployable owner-settable price oracle.
//!
//! This is a **testnet stand-in** for the mainnet Ekubo TWAP adapter (decision Q3). It exposes
//! the same `IPriceOracle` interface the perp engine consumes, with an owner-settable price so a
//! live Sepolia demo can move the market and drive a position into and out of liquidation.
//!
//! On mainnet this is replaced by an adapter that reads an Ekubo TWAP; the perp engine is
//! unchanged because it depends only on `IPriceOracle`. Documented as a stand-in everywhere so
//! no one mistakes an owner-set price for a real feed.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IManualOracle<T> {
    /// Sets the price (owner only). Scaled by 1e18: quote units per one whole base unit.
    fn set_price(ref self: T, price: u128);
    fn owner(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod ManualOracle {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::oracle::IPriceOracle;
    use super::IManualOracle;

    mod errors {
        pub const NOT_OWNER: felt252 = 'NOT_OWNER';
        pub const ZERO_OWNER: felt252 = 'ZERO_OWNER';
    }

    #[storage]
    struct Storage {
        owner: ContractAddress,
        price: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, initial_price: u128) {
        assert(owner.is_non_zero(), errors::ZERO_OWNER);
        self.owner.write(owner);
        self.price.write(initial_price);
    }

    #[abi(embed_v0)]
    pub impl PriceOracleImpl of IPriceOracle<ContractState> {
        fn get_price(
            self: @ContractState, base: ContractAddress, quote: ContractAddress,
        ) -> u128 {
            self.price.read()
        }
    }

    #[abi(embed_v0)]
    pub impl ManualOracleImpl of IManualOracle<ContractState> {
        fn set_price(ref self: ContractState, price: u128) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            self.price.write(price);
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }
    }
}
