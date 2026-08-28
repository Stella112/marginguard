//! Mock Pragma oracle for the adapter test — returns a fixed median response.

#[starknet::contract]
pub mod MockPragma {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::oracle_pragma::{DataType, IPragmaABI, PragmaPricesResponse};

    #[storage]
    struct Storage {
        price: u128,
        decimals: u32,
    }

    #[constructor]
    fn constructor(ref self: ContractState, price: u128, decimals: u32) {
        self.price.write(price);
        self.decimals.write(decimals);
    }

    #[abi(embed_v0)]
    pub impl PragmaImpl of IPragmaABI<ContractState> {
        fn get_data_median(self: @ContractState, data_type: DataType) -> PragmaPricesResponse {
            PragmaPricesResponse {
                price: self.price.read(),
                decimals: self.decimals.read(),
                last_updated_timestamp: 1000,
                num_sources_aggregated: 11,
                expiration_timestamp: Option::None,
            }
        }
    }
}
