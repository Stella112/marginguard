//! EkuboTwapOracle — the mainnet price oracle for the perp engine.
//!
//! Implements `IPriceOracle` by reading a **time-weighted average price** from Ekubo's Oracle
//! extension (decision Q3: TWAP over spot, to resist single-block manipulation). Verified
//! against Ekubo mainnet: extension `0x005e470f…dab38f`, `get_price_x128_over_last(base, quote,
//! period) -> u256` (a Q128.128 fixed-point price, quote-smallest per base-smallest), with a
//! live STRK/USDC pool.
//!
//! Conversion. Ekubo returns `price · 2^128` in raw smallest-unit terms. The perp engine works
//! in prices scaled by 1e18 in the same smallest-unit terms, so:
//!
//!     price_1e18 = x128 · 1e18 / 2^128
//!
//! This is decimal-agnostic — no token decimals are hardcoded, because both the price and the
//! engine's size/margin are in smallest units. The engine consumes it through `IPriceOracle`
//! exactly as it consumed the testnet ManualOracle, so nothing else changes.

use starknet::ContractAddress;

/// The slice of Ekubo's Oracle extension interface this adapter uses. Verified on mainnet.
#[starknet::interface]
pub trait IEkuboOracle<T> {
    fn get_price_x128_over_last(
        self: @T, base_token: ContractAddress, quote_token: ContractAddress, period: u64,
    ) -> u256;
}

#[starknet::interface]
pub trait IEkuboTwapConfig<T> {
    fn ekubo_oracle(self: @T) -> ContractAddress;
    fn period(self: @T) -> u64;
}

#[starknet::contract]
pub mod EkuboTwapOracle {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use crate::oracle::IPriceOracle;
    use super::{IEkuboOracleDispatcher, IEkuboOracleDispatcherTrait, IEkuboTwapConfig};

    /// 1e18, the perp engine's price scale.
    const ONE_E18: u256 = 1000000000000000000;
    /// 2^128, Ekubo's fixed-point denominator.
    const TWO_128: u256 = 0x100000000000000000000000000000000;

    mod errors {
        pub const ZERO_ORACLE: felt252 = 'ZERO_ORACLE';
        pub const ZERO_PERIOD: felt252 = 'ZERO_PERIOD';
        pub const PRICE_OVERFLOW: felt252 = 'PRICE_OVERFLOW';
    }

    #[storage]
    struct Storage {
        ekubo_oracle: ContractAddress,
        period: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, ekubo_oracle: ContractAddress, period: u64) {
        assert(ekubo_oracle.is_non_zero(), errors::ZERO_ORACLE);
        assert(period != 0, errors::ZERO_PERIOD);
        self.ekubo_oracle.write(ekubo_oracle);
        self.period.write(period);
    }

    #[abi(embed_v0)]
    pub impl PriceOracleImpl of IPriceOracle<ContractState> {
        fn get_price(
            self: @ContractState, base: ContractAddress, quote: ContractAddress,
        ) -> u128 {
            let x128 = IEkuboOracleDispatcher { contract_address: self.ekubo_oracle.read() }
                .get_price_x128_over_last(base, quote, self.period.read());
            // price_1e18 = x128 * 1e18 / 2^128. Computed in u256 (x128 * 1e18 cannot wrap: the
            // Ekubo price sits far below 2^128, so the product stays under 2^256), then narrowed.
            let scaled: u256 = (x128 * ONE_E18) / TWO_128;
            scaled.try_into().expect(errors::PRICE_OVERFLOW)
        }
    }

    #[abi(embed_v0)]
    pub impl ConfigImpl of IEkuboTwapConfig<ContractState> {
        fn ekubo_oracle(self: @ContractState) -> ContractAddress {
            self.ekubo_oracle.read()
        }
        fn period(self: @ContractState) -> u64 {
            self.period.read()
        }
    }
}
