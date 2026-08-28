//! PragmaOracle — accurate mainnet price oracle for the perp engine.
//!
//! Reads Pragma's aggregated median spot price (Starknet's standard multi-source oracle) and
//! converts it to the engine's price scale. Chosen after the Ekubo oracle-extension pool was
//! found to diverge ~3x from the real market (its thin extension pools are not arbitraged);
//! Pragma's STRK/USD matched CEX and Ekubo's *relative* prices but not its absolute scale.
//!
//! Pragma returns a human USD price with its own decimals, e.g. STRK/USD = 2439000 at 8dp
//! ($0.02439). USDC ≈ USD, so we treat the Pragma USD price as the USDC price. The engine works
//! in quote-smallest per base-smallest × 1e18, so:
//!
//!     engine_price = pragma_price × 10^(18 + quote_decimals − base_decimals − pragma_decimals)
//!
//! For STRK(18)/USDC(6) with Pragma at 8dp the exponent is −2, i.e. divide by 100 → 24390,
//! matching the real market. The token decimals are constructor config (MarginGuard is a single
//! market, per the non-goals), and Pragma's own decimals are read from each response.

use starknet::ContractAddress;

/// Pragma's DataType enum; SpotEntry is variant 0.
#[derive(Copy, Drop, Serde)]
pub enum DataType {
    SpotEntry: felt252,
    FutureEntry: (felt252, u64),
    GenericEntry: felt252,
}

/// The fields of Pragma's response we read (leading fields, positional Serde).
#[derive(Copy, Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

#[starknet::interface]
pub trait IPragmaABI<T> {
    fn get_data_median(self: @T, data_type: DataType) -> PragmaPricesResponse;
}

#[starknet::interface]
pub trait IPragmaConfig<T> {
    fn pragma(self: @T) -> ContractAddress;
    fn pair_id(self: @T) -> felt252;
}

#[starknet::contract]
pub mod PragmaOracle {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait};
    use crate::oracle::IPriceOracle;
    use super::IPragmaConfig;

    mod errors {
        pub const ZERO_PRAGMA: felt252 = 'ZERO_PRAGMA';
        pub const ZERO_PAIR: felt252 = 'ZERO_PAIR';
        pub const STALE_OR_EMPTY: felt252 = 'STALE_OR_EMPTY';
        pub const PRICE_OVERFLOW: felt252 = 'PRICE_OVERFLOW';
    }

    #[storage]
    struct Storage {
        pragma: ContractAddress,
        pair_id: felt252,
        base_decimals: u8,
        quote_decimals: u8,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pragma: ContractAddress,
        pair_id: felt252,
        base_decimals: u8,
        quote_decimals: u8,
    ) {
        assert(pragma.is_non_zero(), errors::ZERO_PRAGMA);
        assert(pair_id != 0, errors::ZERO_PAIR);
        self.pragma.write(pragma);
        self.pair_id.write(pair_id);
        self.base_decimals.write(base_decimals);
        self.quote_decimals.write(quote_decimals);
    }

    #[abi(embed_v0)]
    pub impl PriceOracleImpl of IPriceOracle<ContractState> {
        fn get_price(
            self: @ContractState, base: ContractAddress, quote: ContractAddress,
        ) -> u128 {
            // Raw call, so we depend only on the leading return fields (price, decimals) and not
            // on Pragma's exact response struct layout (its median response is 6 felts, not the
            // 5 a naive PragmaPricesResponse would serialize to).
            // Calldata is DataType::SpotEntry(pair_id) = [variant 0, pair_id].
            let ret = call_contract_syscall(
                self.pragma.read(),
                selector!("get_data_median"),
                array![0, self.pair_id.read()].span(),
            )
                .unwrap_syscall();
            // ret[0] = price (u128 low felt), ret[1] = decimals.
            let raw_price: felt252 = *ret.at(0);
            let raw_decimals: felt252 = *ret.at(1);
            let price_u128: u128 = raw_price.try_into().expect(errors::STALE_OR_EMPTY);
            assert(price_u128 != 0, errors::STALE_OR_EMPTY);
            let pragma_dec: u32 = raw_decimals.try_into().expect(errors::STALE_OR_EMPTY);

            // engine_price = price * 10^(18 + quote_dec - base_dec - pragma_dec), split into a
            // positive and negative part so no signed arithmetic is needed.
            let pos: u32 = 18 + self.quote_decimals.read().into();
            let neg: u32 = self.base_decimals.read().into() + pragma_dec;
            let price: u256 = price_u128.into();
            let scaled: u256 = if pos >= neg {
                price * pow10(pos - neg)
            } else {
                price / pow10(neg - pos)
            };
            scaled.try_into().expect(errors::PRICE_OVERFLOW)
        }
    }

    #[abi(embed_v0)]
    pub impl ConfigImpl of IPragmaConfig<ContractState> {
        fn pragma(self: @ContractState) -> ContractAddress {
            self.pragma.read()
        }
        fn pair_id(self: @ContractState) -> felt252 {
            self.pair_id.read()
        }
    }

    /// 10^n as a u256, for small n (price scale adjustment).
    fn pow10(n: u32) -> u256 {
        let mut r: u256 = 1;
        let mut i: u32 = 0;
        while i != n {
            r = r * 10;
            i += 1;
        }
        r
    }
}
