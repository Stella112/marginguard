//! Mock Ekubo oracle for the adapter test — returns a fixed Q128 price.


#[starknet::interface]
pub trait IMockEkuboSetter<T> {
    fn set_x128(ref self: T, x128: u256);
}

#[starknet::contract]
pub mod MockEkuboOracle {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use crate::oracle_ekubo::IEkuboOracle;
    use super::IMockEkuboSetter;

    #[storage]
    struct Storage {
        x128: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, x128: u256) {
        self.x128.write(x128);
    }

    #[abi(embed_v0)]
    pub impl EkuboImpl of IEkuboOracle<ContractState> {
        fn get_price_x128_over_last(
            self: @ContractState,
            base_token: ContractAddress,
            quote_token: ContractAddress,
            period: u64,
        ) -> u256 {
            self.x128.read()
        }
    }

    #[abi(embed_v0)]
    pub impl SetterImpl of IMockEkuboSetter<ContractState> {
        fn set_x128(ref self: ContractState, x128: u256) {
            self.x128.write(x128);
        }
    }
}
