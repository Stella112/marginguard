//! MarginGuardVenue — the stateful anonymizer the STRK20 pool calls.
//!
//! This is the contract that holds funds, so it follows the STRK20 security checklist for a
//! stateful helper exactly: the pool address is pinned at construction and asserted on every
//! `privacy_invoke`. A self-declared `pool_address` parameter, as the echo helper uses, is a
//! demonstration of the placeholder — not access control for a contract holding balances.
//!
//! ## Why funding and placement are separate operations
//!
//! The pool's withdraw leg to a helper is a plain **public** ERC-20 transfer. Moving funds in
//! the same transaction that creates an order would publish that order's size. So funding
//! credits a venue balance tied to a `trader_commitment` and to no particular order, and
//! placement afterwards moves no funds at all. Deposit-once, trade-many.
//!
//! ## Why settlement is claim-driven
//!
//! Phase 7 of the STRK20 action table permits at most one `InvokeExternal` per pool
//! transaction, and an open note is created by the `transfer: "OPEN"` action inside its own
//! owner's transaction. Two counterparties therefore cannot be paid in one transaction. Each
//! side claims its own leg, following the documented stateful-escrow pattern.
//!
//! ## Identity
//!
//! Entitlement is knowledge of `owner_secret`, never an address. Nothing here reads
//! `get_caller_address` for authorisation except the pool check, so placement and claiming
//! can both be relayed without linking a user to an order.

use starknet::ContractAddress;

/// Must match `privacy::objects::OpenNoteDeposit` (positional Serde). Defined locally for the
/// same reason the echo helper defines it locally: the privacy package is not published as a
/// Scarb dependency.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Which leg of the venue the pool is driving.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum VenueOperation {
    /// Credit a venue balance from funds the pool has just withdrawn here.
    /// Returns an empty span — the funds stay parked.
    Fund,
    /// Pay out a matched order's proceeds into the caller's open note.
    Claim,
    /// Return a free (unreserved) venue balance to the owner's open note.
    ///
    /// Without this the venue is a one-way door: funds enter on Fund and leave only on
    /// Claim, which needs a matched order, so an order that never found a counterparty
    /// trapped its reserve permanently. Cancel releases a reserve back to the balance;
    /// this is how that balance gets out.
    Withdraw,
    /// Cancel a live order and release its reserve back to the owner's venue balance.
    ///
    /// Routed through the pool like every other leg. Calling the book directly would link
    /// the canceller's address to the order id and undo the anonymity the venue exists for.
    Cancel,
}

#[starknet::interface]
pub trait IErc20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IMarginGuardVenue<T> {
    /// The entry point the pool calls via `INVOKE_SELECTOR`.
    ///
    /// Calldata order must match this signature exactly — the pool deserializes directly
    /// into these parameters.
    ///
    /// **Fund** — credits `balances[(trader_commitment, token)]`. `owner_secret`, `order_id`
    /// and `note_id` are ignored. Returns an empty span.
    ///
    /// **Claim** — pays a matched order's proceeds. The claimant reveals `owner_secret` and
    /// the order's terms; the contract re-derives both commitments before paying. `amount` is
    /// ignored (the payout is computed from the recorded fill, never supplied).
    fn privacy_invoke(
        ref self: T,
        operation: VenueOperation,
        trader_commitment: felt252,
        token: ContractAddress,
        amount: u128,
        owner_secret: felt252,
        order_id: felt252,
        side: u8,
        price: u128,
        size: u128,
        salt: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Reserves funds and places a resting order. Callable by anyone — entitlement is the
    /// secret behind `trader_commitment`, so a relayer may place on a user's behalf without
    /// the user's address appearing.
    fn place_order(
        ref self: T,
        order_id: felt252,
        trader_commitment: felt252,
        commitment: felt252,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        reserve_token: ContractAddress,
        reserve_amount: u128,
    );

    fn balance_of(self: @T, trader_commitment: felt252, token: ContractAddress) -> u128;
    fn reserved_of(self: @T, order_id: felt252) -> (ContractAddress, u128);
    fn is_claimed(self: @T, order_id: felt252) -> bool;
    fn privacy_pool(self: @T) -> ContractAddress;
    fn order_book(self: @T) -> ContractAddress;
}

pub mod errors {
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
    pub const ZERO_POOL: felt252 = 'ZERO_POOL';
    pub const ZERO_ORDER_BOOK: felt252 = 'ZERO_ORDER_BOOK';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const UNDERFUNDED: felt252 = 'UNDERFUNDED';
    pub const INSUFFICIENT_BALANCE: felt252 = 'INSUFFICIENT_BALANCE';
    pub const BAD_OWNER_SECRET: felt252 = 'BAD_OWNER_SECRET';
    pub const COMMITMENT_MISMATCH: felt252 = 'COMMITMENT_MISMATCH';
    pub const NOT_MATCHED: felt252 = 'NOT_MATCHED';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const NOTHING_TO_CLAIM: felt252 = 'NOTHING_TO_CLAIM';
    pub const PAYOUT_OVERFLOW: felt252 = 'PAYOUT_OVERFLOW';
    pub const ORDER_ALREADY_RESERVED: felt252 = 'ORDER_ALREADY_RESERVED';
    pub const WRONG_CLAIM_TOKEN: felt252 = 'WRONG_CLAIM_TOKEN';
    pub const CREDIT_OVERFLOW: felt252 = 'CREDIT_OVERFLOW';
    pub const INSUFFICIENT_RESERVE: felt252 = 'INSUFFICIENT_RESERVE';
    pub const TOTAL_CREDITED_UNDERFLOW: felt252 = 'TOTAL_CREDITED_UNDERFLOW';
}

/// Fixed-point scale for `price`, expressed as quote units per one whole base unit.
pub const PRICE_SCALE: u256 = 1000000000000000000; // 1e18

#[starknet::contract]
pub mod MarginGuardVenue {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::commitments::{compute_order_commitment, compute_trader_commitment};
    use crate::order_book::{IOrderBookDispatcher, IOrderBookDispatcherTrait};
    use crate::types::SIDE_BUY;
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, IMarginGuardVenue, OpenNoteDeposit, PRICE_SCALE,
        VenueOperation, errors,
    };

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        order_book: ContractAddress,
        /// (trader_commitment, token) -> spendable venue balance.
        balances: Map<(felt252, ContractAddress), u128>,
        /// Total credited per token. Never allowed to exceed what the venue actually holds.
        total_credited: Map<ContractAddress, u128>,
        /// order_id -> reserved token.
        reserved_token: Map<felt252, ContractAddress>,
        /// order_id -> reserved amount.
        reserved_amount: Map<felt252, u128>,
        claimed: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Funded: Funded,
        OrderReserved: OrderReserved,
        Claimed: Claimed,
        Withdrawn: Withdrawn,
        OrderCancelled: OrderCancelled,
    }

    /// The funding amount is public regardless — the pool's withdraw leg is a public
    /// transfer — but it is tied to a commitment, not to an address or an order.
    #[derive(Drop, starknet::Event)]
    pub struct Funded {
        #[key]
        pub trader_commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderReserved {
        #[key]
        pub order_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub order_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    /// Keyed by commitment, never by address - the same identity rule as Funded.
    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub trader_commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCancelled {
        #[key]
        pub order_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, privacy_pool: ContractAddress, order_book: ContractAddress,
    ) {
        assert(privacy_pool.is_non_zero(), errors::ZERO_POOL);
        assert(order_book.is_non_zero(), errors::ZERO_ORDER_BOOK);
        self.privacy_pool.write(privacy_pool);
        self.order_book.write(order_book);
    }

    #[abi(embed_v0)]
    pub impl MarginGuardVenueImpl of IMarginGuardVenue<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: VenueOperation,
            trader_commitment: felt252,
            token: ContractAddress,
            amount: u128,
            owner_secret: felt252,
            order_id: felt252,
            side: u8,
            price: u128,
            size: u128,
            salt: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Threat T1. This venue is stateful and holds funds across transactions, so the
            // pool address is pinned rather than trusted from calldata.
            let pool = self.privacy_pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_PRIVACY);

            match operation {
                VenueOperation::Fund => self.do_fund(trader_commitment, token, amount),
                VenueOperation::Claim => self
                    .do_claim(pool, owner_secret, order_id, side, price, size, salt, note_id),
                VenueOperation::Withdraw => self
                    .do_withdraw(pool, owner_secret, token, amount, note_id),
                VenueOperation::Cancel => self.do_cancel(owner_secret, order_id),
            }
        }

        fn place_order(
            ref self: ContractState,
            order_id: felt252,
            trader_commitment: felt252,
            commitment: felt252,
            base_token: ContractAddress,
            quote_token: ContractAddress,
            reserve_token: ContractAddress,
            reserve_amount: u128,
        ) {
            assert(reserve_amount.is_non_zero(), errors::ZERO_AMOUNT);
            assert(self.reserved_token.read(order_id).is_zero(), errors::ORDER_ALREADY_RESERVED);

            // Move the reserve out of the spendable balance, so the same funds cannot back
            // two resting orders at once.
            let key = (trader_commitment, reserve_token);
            let available = self.balances.read(key);
            assert(available >= reserve_amount, errors::INSUFFICIENT_BALANCE);
            self.balances.write(key, available - reserve_amount);

            self.reserved_token.write(order_id, reserve_token);
            self.reserved_amount.write(order_id, reserve_amount);

            IOrderBookDispatcher { contract_address: self.order_book.read() }
                .place_order(
                    order_id, trader_commitment, commitment, base_token, quote_token,
                );

            self
                .emit(
                    OrderReserved { order_id, token: reserve_token, amount: reserve_amount },
                );
        }

        fn balance_of(
            self: @ContractState, trader_commitment: felt252, token: ContractAddress,
        ) -> u128 {
            self.balances.read((trader_commitment, token))
        }

        fn reserved_of(self: @ContractState, order_id: felt252) -> (ContractAddress, u128) {
            (self.reserved_token.read(order_id), self.reserved_amount.read(order_id))
        }

        fn is_claimed(self: @ContractState, order_id: felt252) -> bool {
            self.claimed.read(order_id)
        }

        fn privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn order_book(self: @ContractState) -> ContractAddress {
            self.order_book.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Credits a venue balance from funds the pool has already transferred here.
        ///
        /// The credited total per token is checked against the venue's real ERC-20 balance, so
        /// the venue can never promise more than it holds — whatever a caller claims in
        /// `amount`, and whatever the token does on transfer.
        fn do_fund(
            ref self: ContractState,
            trader_commitment: felt252,
            token: ContractAddress,
            amount: u128,
        ) -> Span<OpenNoteDeposit> {
            assert(trader_commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

            let credited_u256: u256 = self.total_credited.read(token).into() + amount.into();
            let credited: u128 = credited_u256.try_into().expect(errors::CREDIT_OVERFLOW);
            let held: u256 = IErc20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            assert(held >= credited.into(), errors::UNDERFUNDED);

            self.total_credited.write(token, credited);
            let key = (trader_commitment, token);
            let balance_u256: u256 = self.balances.read(key).into() + amount.into();
            let balance: u128 = balance_u256.try_into().expect(errors::CREDIT_OVERFLOW);
            self.balances.write(key, balance);

            self.emit(Funded { trader_commitment, token, amount });

            // Funds stay parked. Nothing to credit into a note yet.
            [].span()
        }

        /// Cancels a live order and returns its reserve to the owner's venue balance.
        ///
        /// The book verifies the secret and the order's state, then this releases the
        /// reserve. Withdraw is the separate step that takes the balance out of the venue -
        /// two pool transactions, because a pool transaction carries at most one invoke.
        fn do_cancel(
            ref self: ContractState, owner_secret: felt252, order_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // The book re-derives the trader commitment and refuses a matched or dead order.
            IOrderBookDispatcher { contract_address: self.order_book.read() }
                .cancel_order(order_id, owner_secret);

            let token = self.reserved_token.read(order_id);
            let amount = self.reserved_amount.read(order_id);
            if amount.is_non_zero() {
                // Clear the reserve before crediting so a repeated call cannot double-credit.
                self.reserved_amount.write(order_id, 0);
                let trader_commitment = compute_trader_commitment(owner_secret);
                let key = (trader_commitment, token);
                let balance_u256: u256 = self.balances.read(key).into() + amount.into();
                let balance: u128 = balance_u256.try_into().expect(errors::CREDIT_OVERFLOW);
                self.balances.write(key, balance);
            }

            self.emit(OrderCancelled { order_id, token, amount });

            // Nothing leaves the venue here; the balance is withdrawn separately.
            [].span()
        }

        /// Returns a free venue balance to the owner, credited into an open note.
        ///
        /// Mirrors Claim's identity rule: entitlement is the owner secret, never an address.
        /// Only the unreserved balance can leave this way - a live order's reserve is held in
        /// `reserved_amount` and is released by `cancel_order` first.
        fn do_withdraw(
            ref self: ContractState,
            pool: ContractAddress,
            owner_secret: felt252,
            token: ContractAddress,
            amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

            let trader_commitment = compute_trader_commitment(owner_secret);
            let key = (trader_commitment, token);
            let balance = self.balances.read(key);
            assert(balance >= amount, errors::INSUFFICIENT_BALANCE);
            self.balances.write(key, balance - amount);

            let credited = self.total_credited.read(token);
            assert(credited >= amount, errors::TOTAL_CREDITED_UNDERFLOW);
            self.total_credited.write(token, credited - amount);

            // Approve, do not transfer - the pool executes the pull itself (rule 2).
            IErc20Dispatcher { contract_address: token }.approve(pool, amount.into());

            self.emit(Withdrawn { trader_commitment, token, amount });

            [OpenNoteDeposit { note_id, token, amount }].span()
        }

        /// Pays a matched order's proceeds into the claimant's open note.
        fn do_claim(
            ref self: ContractState,
            pool: ContractAddress,
            owner_secret: felt252,
            order_id: felt252,
            side: u8,
            price: u128,
            size: u128,
            salt: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(!self.claimed.read(order_id), errors::ALREADY_CLAIMED);

            let book = IOrderBookDispatcher { contract_address: self.order_book.read() };
            let entry = book.get_order(order_id);
            assert(entry.matched, errors::NOT_MATCHED);

            // Entitlement is the secret, not an address (threat T2 and the identity rule).
            assert(
                compute_trader_commitment(owner_secret) == entry.trader_commitment,
                errors::BAD_OWNER_SECRET,
            );

            // Re-derive the order's own commitment before believing the revealed side. The
            // side decides which token is owed, so accepting it unverified would let a
            // claimant pick the more valuable leg (threat T3).
            assert(
                compute_order_commitment(side, price, size, salt) == entry.commitment,
                errors::COMMITMENT_MISMATCH,
            );

            let (fill_price, filled_size) = book.get_fill(order_id);
            assert(filled_size.is_non_zero(), errors::NOTHING_TO_CLAIM);

            // A buyer paid quote and receives base; a seller paid base and receives quote.
            // Payout is computed from the recorded fill, never from a supplied amount.
            let (payout_token, payout_amount) = if side == SIDE_BUY {
                (entry.base_token, filled_size)
            } else {
                (entry.quote_token, quote_amount(filled_size, fill_price))
            };

            // A resting order may have reserved more than the matched fill. Return the unused
            // portion to the same commitment balance instead of silently trapping it.
            let trader_commitment = compute_trader_commitment(owner_secret);
            let consumed = if side == SIDE_BUY {
                payout_amount
            } else {
                filled_size
            };
            let reserved_token = self.reserved_token.read(order_id);
            let reserved_amount = self.reserved_amount.read(order_id);
            assert(reserved_amount >= consumed, errors::INSUFFICIENT_RESERVE);
            let refund = reserved_amount - consumed;
            if refund.is_non_zero() {
                let balance_key = (trader_commitment, reserved_token);
                let balance_u256: u256 = self.balances.read(balance_key).into() + refund.into();
                let balance: u128 = balance_u256.try_into().expect(errors::CREDIT_OVERFLOW);
                self.balances.write(balance_key, balance);
            }

            self.claimed.write(order_id, true);

            // The token leaving the venue is the payout token, not necessarily the token the
            // claimant reserved. Decrement the per-token ledger by the actual payout.
            let credited = self.total_credited.read(payout_token);
            assert(credited >= payout_amount, errors::TOTAL_CREDITED_UNDERFLOW);
            self.total_credited.write(payout_token, credited - payout_amount);

            // Approve, do not transfer — the pool executes the pull itself (rule 2).
            IErc20Dispatcher { contract_address: payout_token }
                .approve(pool, payout_amount.into());

            self
                .emit(
                    Claimed { order_id, token: payout_token, amount: payout_amount },
                );

            [OpenNoteDeposit { note_id, token: payout_token, amount: payout_amount }].span()
        }
    }

    /// `size * price / PRICE_SCALE`, computed in u256 so the intermediate product cannot wrap,
    /// then narrowed with an explicit error rather than a silent truncation.
    fn quote_amount(size: u128, price: u128) -> u128 {
        let product: u256 = size.into() * price.into();
        let scaled: u256 = product / PRICE_SCALE;
        scaled.try_into().expect(errors::PAYOUT_OVERFLOW)
    }

}
