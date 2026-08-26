//! A minimal ERC-20 for integration tests only.
//!
//! It implements exactly the surface MarginGuardVenue touches — `balance_of`, `approve`,
//! `transfer_from` — plus a permissionless `mint` so a test can stage balances. It is never
//! deployed outside `scarb cairo-test`.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockErc20<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod MockErc20 {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockErc20;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    pub impl MockErc20Impl of IMockErc20<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let bal = self.balances.read(from);
            assert(bal >= amount, 'MOCK_INSUFFICIENT');
            self.balances.write(from, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        /// Pulls on a standing allowance, exactly as the pool does after the venue approves it.
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowed = self.allowances.read((sender, spender));
            assert(allowed >= amount, 'MOCK_ALLOWANCE');
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'MOCK_INSUFFICIENT');
            if !allowed.is_zero() {
                self.allowances.write((sender, spender), allowed - amount);
            }
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
    }
}
