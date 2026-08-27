//! A settable price oracle for perp-engine tests.
//!
//! The mainnet oracle is an Ekubo TWAP adapter (decision Q3). For deterministic tests, this
//! mock lets a test set an exact price and move it to drive a position into and out of a
//! liquidatable state.


#[starknet::interface]
pub trait IMockOracle<T> {
    fn set_price(ref self: T, price: u128);
}

#[starknet::contract]
pub mod MockOracle {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use crate::oracle::IPriceOracle;
    use super::IMockOracle;

    #[storage]
    struct Storage {
        price: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, price: u128) {
        self.price.write(price);
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
    pub impl MockOracleImpl of IMockOracle<ContractState> {
        fn set_price(ref self: ContractState, price: u128) {
            self.price.write(price);
        }
    }
}
