//! The shared order book.
//!
//! Public state is exactly what the brief permits: existence, a `live` flag, a `matched` flag,
//! and the token pair. Side, price and size exist on-chain only inside a Poseidon commitment
//! until the order is revealed at match time.
//!
//! Placement moves **no funds**. That is deliberate and load-bearing: the pool's withdraw leg
//! to a helper is a plain public ERC-20 transfer, so funding inside the placing transaction
//! would publish the order's size. Funding is a separate step against a venue balance (Phase 2),
//! which leaves a resting order leaking neither size nor price.

use starknet::ContractAddress;
use crate::types::OrderEntry;

#[starknet::interface]
pub trait IOrderBook<T> {
    /// Places a resting order. Only the commitments and the token pair reach storage.
    ///
    /// `order_id` is chosen by the caller and must be unused. `trader_commitment` is
    /// `poseidon(TRADER_TAG, owner_secret)`; whoever can produce the preimage later owns
    /// the fill, so the book never records an address.
    fn place_order(
        ref self: T,
        order_id: felt252,
        trader_commitment: felt252,
        commitment: felt252,
        base_token: ContractAddress,
        quote_token: ContractAddress,
    );

    /// Cancels a live, unmatched order. Requires the `owner_secret` preimage.
    fn cancel_order(ref self: T, order_id: felt252, owner_secret: felt252);

    /// Matches two opposing orders.
    ///
    /// Deterministic arithmetic only — no agent, no judgment, no discretion. Both sides are
    /// revealed here because a commitment cannot be compared against another commitment
    /// on-chain (C3). The contract re-derives each commitment from the revealed values before
    /// trusting any of them, so a false reveal cannot match.
    ///
    /// Execution is at the midpoint of the two limit prices, and the filled size is the
    /// smaller of the two.
    fn match_orders(
        ref self: T,
        buy_order_id: felt252,
        buy_price: u128,
        buy_size: u128,
        buy_salt: felt252,
        sell_order_id: felt252,
        sell_price: u128,
        sell_size: u128,
        sell_salt: felt252,
    );

    /// Binds the book to its venue, once. Placement and cancellation are restricted to that
    /// venue thereafter.
    ///
    /// This exists because the venue's constructor takes the book's address, so the two
    /// cannot both know each other at deployment. The book is deployed first, the venue
    /// second, and this call closes the loop.
    fn initialize_venue(ref self: T, venue: ContractAddress);

    fn get_order(self: @T, order_id: felt252) -> OrderEntry;
    fn is_live(self: @T, order_id: felt252) -> bool;
    fn is_matched(self: @T, order_id: felt252) -> bool;
    fn venue(self: @T) -> ContractAddress;

    /// Execution price and filled size recorded for a matched order. Zero if unmatched.
    /// Public post-trade by necessity: the claim leg credits an open note, whose amount is
    /// plaintext by protocol design.
    fn get_fill(self: @T, order_id: felt252) -> (u128, u128);
}

pub mod errors {
    pub const ZERO_ORDER_ID: felt252 = 'ZERO_ORDER_ID';
    pub const ORDER_EXISTS: felt252 = 'ORDER_EXISTS';
    pub const ORDER_NOT_FOUND: felt252 = 'ORDER_NOT_FOUND';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TRADER_COMMITMENT: felt252 = 'ZERO_TRADER_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const SAME_TOKEN: felt252 = 'SAME_TOKEN';
    pub const NOT_LIVE: felt252 = 'NOT_LIVE';
    pub const ALREADY_MATCHED: felt252 = 'ALREADY_MATCHED';
    pub const BAD_OWNER_SECRET: felt252 = 'BAD_OWNER_SECRET';
    pub const COMMITMENT_MISMATCH: felt252 = 'COMMITMENT_MISMATCH';
    pub const PAIR_MISMATCH: felt252 = 'PAIR_MISMATCH';
    pub const NOT_CROSSING: felt252 = 'NOT_CROSSING';
    pub const SELF_MATCH: felt252 = 'SELF_MATCH';
    pub const ZERO_SIZE: felt252 = 'ZERO_SIZE';
    pub const ZERO_PRICE: felt252 = 'ZERO_PRICE';
    pub const CALLER_NOT_VENUE: felt252 = 'CALLER_NOT_VENUE';
    pub const VENUE_ALREADY_SET: felt252 = 'VENUE_ALREADY_SET';
    pub const ZERO_VENUE: felt252 = 'ZERO_VENUE';
}

#[starknet::contract]
pub mod OrderBook {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use crate::commitments::{compute_order_commitment, compute_trader_commitment};
    use crate::types::{OrderEntry, SIDE_BUY, SIDE_SELL};
    use super::{IOrderBook, errors};

    #[storage]
    struct Storage {
        /// The venue permitted to place and cancel. Matching stays permissionless.
        venue: ContractAddress,
        orders: Map<felt252, OrderEntry>,
        /// Execution price per matched order.
        fill_price: Map<felt252, u128>,
        /// Filled size per matched order.
        fill_size: Map<felt252, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OrderPlaced: OrderPlaced,
        OrderCancelled: OrderCancelled,
        OrdersMatched: OrdersMatched,
    }

    /// Carries no size and no price — only that an order now exists on this pair.
    #[derive(Drop, starknet::Event)]
    pub struct OrderPlaced {
        #[key]
        pub order_id: felt252,
        pub base_token: ContractAddress,
        pub quote_token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCancelled {
        #[key]
        pub order_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrdersMatched {
        #[key]
        pub buy_order_id: felt252,
        #[key]
        pub sell_order_id: felt252,
        pub execution_price: u128,
        pub filled_size: u128,
    }

    #[abi(embed_v0)]
    pub impl OrderBookImpl of IOrderBook<ContractState> {
        fn place_order(
            ref self: ContractState,
            order_id: felt252,
            trader_commitment: felt252,
            commitment: felt252,
            base_token: ContractAddress,
            quote_token: ContractAddress,
        ) {
            // Only the venue may place, because only the venue reserves the backing funds.
            // An unbacked order left resting in the book would grief whoever matched it:
            // the match would succeed and the claim would find nothing to pay.
            self.assert_caller_is_venue();
            assert(order_id.is_non_zero(), errors::ZERO_ORDER_ID);
            assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(trader_commitment.is_non_zero(), errors::ZERO_TRADER_COMMITMENT);
            assert(base_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(quote_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(base_token != quote_token, errors::SAME_TOKEN);

            let existing = self.orders.read(order_id);
            assert(existing.commitment.is_zero(), errors::ORDER_EXISTS);

            self
                .orders
                .write(
                    order_id,
                    OrderEntry {
                        trader_commitment,
                        commitment,
                        base_token,
                        quote_token,
                        live: true,
                        matched: false,
                        claimed: false,
                    },
                );

            self.emit(OrderPlaced { order_id, base_token, quote_token });
        }

        fn cancel_order(ref self: ContractState, order_id: felt252, owner_secret: felt252) {
            // Routed through the venue so the reserve is released in the same transaction.
            self.assert_caller_is_venue();
            let entry = self.orders.read(order_id);
            assert(entry.commitment.is_non_zero(), errors::ORDER_NOT_FOUND);
            // Matched is checked before live: a match clears `live` and sets `matched`, so
            // testing `live` first would report every filled order as merely "not live" and
            // hide the real reason from the caller.
            assert(!entry.matched, errors::ALREADY_MATCHED);
            assert(entry.live, errors::NOT_LIVE);
            assert(
                compute_trader_commitment(owner_secret) == entry.trader_commitment,
                errors::BAD_OWNER_SECRET,
            );

            self.orders.write(order_id, OrderEntry { live: false, ..entry });
            self.emit(OrderCancelled { order_id });
        }

        fn match_orders(
            ref self: ContractState,
            buy_order_id: felt252,
            buy_price: u128,
            buy_size: u128,
            buy_salt: felt252,
            sell_order_id: felt252,
            sell_price: u128,
            sell_size: u128,
            sell_salt: felt252,
        ) {
            assert(buy_order_id != sell_order_id, errors::SELF_MATCH);

            let buy = self.orders.read(buy_order_id);
            let sell = self.orders.read(sell_order_id);

            assert(buy.commitment.is_non_zero(), errors::ORDER_NOT_FOUND);
            assert(sell.commitment.is_non_zero(), errors::ORDER_NOT_FOUND);
            // Matched before live, for the same diagnostic reason as in `cancel_order`.
            assert(!buy.matched && !sell.matched, errors::ALREADY_MATCHED);
            assert(buy.live && sell.live, errors::NOT_LIVE);

            // Same market, same orientation.
            assert(
                buy.base_token == sell.base_token && buy.quote_token == sell.quote_token,
                errors::PAIR_MISMATCH,
            );

            assert(buy_price.is_non_zero() && sell_price.is_non_zero(), errors::ZERO_PRICE);
            assert(buy_size.is_non_zero() && sell_size.is_non_zero(), errors::ZERO_SIZE);

            // Verify each reveal against its stored commitment *before* trusting any value.
            // This is what makes a false reveal unmatchable (threat T3), and it is also where
            // the sides are pinned: the buy order must genuinely have been committed as a buy.
            assert(
                compute_order_commitment(SIDE_BUY, buy_price, buy_size, buy_salt)
                    == buy.commitment,
                errors::COMMITMENT_MISMATCH,
            );
            assert(
                compute_order_commitment(SIDE_SELL, sell_price, sell_size, sell_salt)
                    == sell.commitment,
                errors::COMMITMENT_MISMATCH,
            );

            // The crossing condition, now over revealed values.
            assert(buy_price >= sell_price, errors::NOT_CROSSING);

            // Midpoint execution. Integer division truncates by at most 1 unit, which favours
            // the seller by under one price tick; the alternative (rounding up) would favour
            // the buyer by the same margin. Documented rather than silently chosen.
            let execution_price = (buy_price + sell_price) / 2;
            let filled_size = if buy_size < sell_size {
                buy_size
            } else {
                sell_size
            };

            self.orders.write(buy_order_id, OrderEntry { live: false, matched: true, ..buy });
            self.orders.write(sell_order_id, OrderEntry { live: false, matched: true, ..sell });

            self.fill_price.write(buy_order_id, execution_price);
            self.fill_price.write(sell_order_id, execution_price);
            self.fill_size.write(buy_order_id, filled_size);
            self.fill_size.write(sell_order_id, filled_size);

            self
                .emit(
                    OrdersMatched {
                        buy_order_id, sell_order_id, execution_price, filled_size,
                    },
                );
        }

        fn initialize_venue(ref self: ContractState, venue: ContractAddress) {
            assert(venue.is_non_zero(), errors::ZERO_VENUE);
            assert(self.venue.read().is_zero(), errors::VENUE_ALREADY_SET);
            self.venue.write(venue);
        }

        fn get_order(self: @ContractState, order_id: felt252) -> OrderEntry {
            self.orders.read(order_id)
        }

        fn venue(self: @ContractState) -> ContractAddress {
            self.venue.read()
        }

        fn is_live(self: @ContractState, order_id: felt252) -> bool {
            self.orders.read(order_id).live
        }

        fn is_matched(self: @ContractState, order_id: felt252) -> bool {
            self.orders.read(order_id).matched
        }

        fn get_fill(self: @ContractState, order_id: felt252) -> (u128, u128) {
            (self.fill_price.read(order_id), self.fill_size.read(order_id))
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_caller_is_venue(self: @ContractState) {
            let venue = self.venue.read();
            // An uninitialised book has no venue and accepts nothing, rather than defaulting
            // open until someone remembers to close it.
            assert(venue.is_non_zero() && get_caller_address() == venue, errors::CALLER_NOT_VENUE);
        }
    }
}
