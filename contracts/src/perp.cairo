//! PerpEngine — private leveraged positions on STRK20.
//!
//! A position's economics — side, size, entry price, margin, leverage — are shielded behind a
//! Poseidon commitment while it is open, exactly as an order's terms are (C3 in the architecture
//! report). The values are revealed to the contract only when an action needs to evaluate them:
//! close, liquidation, or (Phase 4) an agent adjustment. On every such action the contract
//! re-derives `poseidon(POSITION_TAG, side, size, entry, margin, leverage, salt)` and checks it
//! against the stored commitment before trusting a single number.
//!
//! ## What is public vs. shielded
//!
//! Public: that a position exists, its market (token pair), its open/closed/liquidated flags,
//! and — once it settles — the settlement amount (an open-note amount is plaintext by protocol).
//! Shielded while open: size, entry price, margin, leverage, PnL, and the liquidation threshold.
//!
//! ## Liquidation and the knowledge requirement
//!
//! Liquidation authorization is open — there is no keeper whitelist. But because the position's
//! economics are shielded, a liquidator must *reveal* values matching the commitment; the
//! contract then independently reads the oracle and confirms the maintenance threshold is
//! breached. A liquidator can therefore fabricate neither the position's state (commitment
//! check) nor the price (oracle read). In practice the party with knowledge — the owner, the
//! agent, or a keeper they share values with — surfaces a liquidatable position; the contract is
//! the final authority on whether it truly is.
//!
//! ## Custody
//!
//! This engine is the accounting brain: it tracks positions, values them against the oracle, and
//! computes settlement. Physical collateral custody reuses the venue's fund/claim rails — the
//! settlement amount recorded here is what the venue's claim leg pays into an open note. Wiring
//! that path is integration work (Phase 5); the engine is what it targets.

use starknet::ContractAddress;
use crate::types::PositionEntry;

#[starknet::interface]
pub trait IPerpEngine<T> {
    /// Opens a position. Only the commitment and the market reach storage; the economics stay
    /// shielded. `trader_commitment` binds the owner without naming an address, as orders do.
    fn open_position(
        ref self: T,
        position_id: felt252,
        trader_commitment: felt252,
        commitment: felt252,
        base_token: ContractAddress,
        quote_token: ContractAddress,
    );

    /// Closes a position the caller can prove they own, settling equity (margin + PnL, floored
    /// at zero) in the quote token. Requires the `owner_secret` preimage and the committed
    /// economics.
    fn close_position(
        ref self: T,
        position_id: felt252,
        owner_secret: felt252,
        side: u8,
        size: u128,
        entry_price: u128,
        margin: u128,
        leverage: u8,
        salt: felt252,
    );

    /// Liquidates a position whose maintenance threshold the oracle price has breached.
    /// Permissionless in authorization, but the caller must reveal committed values and the
    /// contract confirms the breach itself. Any residual equity is settled to the owner.
    fn liquidate(
        ref self: T,
        position_id: felt252,
        side: u8,
        size: u128,
        entry_price: u128,
        margin: u128,
        leverage: u8,
        salt: felt252,
    );

    /// Pure read: is this position liquidatable at the given revealed values and current oracle
    /// price? Reverts if the values do not match the commitment, so it cannot be used to probe.
    fn is_liquidatable(
        self: @T,
        position_id: felt252,
        side: u8,
        size: u128,
        entry_price: u128,
        margin: u128,
        leverage: u8,
        salt: felt252,
    ) -> bool;

    fn get_position(self: @T, position_id: felt252) -> PositionEntry;
    fn is_open(self: @T, position_id: felt252) -> bool;
    /// (settlement_token, settlement_amount) recorded once a position closes or liquidates.
    fn get_settlement(self: @T, position_id: felt252) -> (ContractAddress, u128);
    fn oracle(self: @T) -> ContractAddress;
}

pub mod errors {
    pub const ZERO_ORACLE: felt252 = 'ZERO_ORACLE';
    pub const ZERO_POSITION_ID: felt252 = 'ZERO_POSITION_ID';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TRADER_COMMITMENT: felt252 = 'ZERO_TRADER_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const SAME_TOKEN: felt252 = 'SAME_TOKEN';
    pub const ZERO_SIZE: felt252 = 'ZERO_SIZE';
    pub const ZERO_MARGIN: felt252 = 'ZERO_MARGIN';
    pub const ZERO_ENTRY: felt252 = 'ZERO_ENTRY';
    pub const BAD_LEVERAGE: felt252 = 'BAD_LEVERAGE';
    pub const POSITION_EXISTS: felt252 = 'POSITION_EXISTS';
    pub const POSITION_NOT_FOUND: felt252 = 'POSITION_NOT_FOUND';
    pub const NOT_OPEN: felt252 = 'NOT_OPEN';
    pub const BAD_OWNER_SECRET: felt252 = 'BAD_OWNER_SECRET';
    pub const COMMITMENT_MISMATCH: felt252 = 'COMMITMENT_MISMATCH';
    pub const NOT_LIQUIDATABLE: felt252 = 'NOT_LIQUIDATABLE';
    pub const VALUE_OVERFLOW: felt252 = 'VALUE_OVERFLOW';
}

/// Maintenance margin as a fraction of posted margin. The brief fixes it at 50%.
pub const MAINTENANCE_BPS: u128 = 5000;
pub const BPS_DENOMINATOR: u128 = 10000;

/// Supported leverage tiers, per the brief: 2x, 5x, 10x.
pub const MAX_LEVERAGE: u8 = 10;

#[starknet::contract]
pub mod PerpEngine {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::ContractAddress;
    use crate::commitments::{compute_position_commitment, compute_trader_commitment};
    use crate::oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
    use crate::types::{PositionEntry, SIDE_BUY, SIDE_SELL};
    use super::{
        BPS_DENOMINATOR, IPerpEngine, MAINTENANCE_BPS, MAX_LEVERAGE, errors,
    };

    /// Price fixed-point scale: quote units per one whole base unit.
    const PRICE_SCALE: u256 = 1000000000000000000; // 1e18

    #[storage]
    struct Storage {
        oracle: ContractAddress,
        positions: Map<felt252, PositionEntry>,
        settlement_token: Map<felt252, ContractAddress>,
        settlement_amount: Map<felt252, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PositionOpened: PositionOpened,
        PositionClosed: PositionClosed,
        PositionLiquidated: PositionLiquidated,
    }

    /// Existence and market are public; economics are not.
    #[derive(Drop, starknet::Event)]
    pub struct PositionOpened {
        #[key]
        pub position_id: felt252,
        pub base_token: ContractAddress,
        pub quote_token: ContractAddress,
    }

    /// The settlement amount is public because it is paid via an open note (plaintext by
    /// protocol). Entry, size, margin and leverage were never published.
    #[derive(Drop, starknet::Event)]
    pub struct PositionClosed {
        #[key]
        pub position_id: felt252,
        pub settlement_token: ContractAddress,
        pub settlement_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionLiquidated {
        #[key]
        pub position_id: felt252,
        pub settlement_token: ContractAddress,
        pub residual_to_owner: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, oracle: ContractAddress) {
        assert(oracle.is_non_zero(), errors::ZERO_ORACLE);
        self.oracle.write(oracle);
    }

    #[abi(embed_v0)]
    pub impl PerpEngineImpl of IPerpEngine<ContractState> {
        fn open_position(
            ref self: ContractState,
            position_id: felt252,
            trader_commitment: felt252,
            commitment: felt252,
            base_token: ContractAddress,
            quote_token: ContractAddress,
        ) {
            assert(position_id.is_non_zero(), errors::ZERO_POSITION_ID);
            assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(trader_commitment.is_non_zero(), errors::ZERO_TRADER_COMMITMENT);
            assert(base_token.is_non_zero() && quote_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(base_token != quote_token, errors::SAME_TOKEN);
            assert(self.positions.read(position_id).commitment.is_zero(), errors::POSITION_EXISTS);

            self
                .positions
                .write(
                    position_id,
                    PositionEntry {
                        trader_commitment,
                        commitment,
                        base_token,
                        quote_token,
                        open: true,
                        liquidated: false,
                    },
                );

            self.emit(PositionOpened { position_id, base_token, quote_token });
        }

        fn close_position(
            ref self: ContractState,
            position_id: felt252,
            owner_secret: felt252,
            side: u8,
            size: u128,
            entry_price: u128,
            margin: u128,
            leverage: u8,
            salt: felt252,
        ) {
            let entry = self.open_and_verified(position_id, side, size, entry_price, margin, leverage, salt);
            assert(
                compute_trader_commitment(owner_secret) == entry.trader_commitment,
                errors::BAD_OWNER_SECRET,
            );

            // Equity = margin + PnL, floored at zero. This is what the owner walks away with.
            let price = self.price_of(entry);
            let equity = equity_of(side, size, entry_price, margin, price);

            self.settle(position_id, entry, equity);
            self.emit(
                PositionClosed {
                    position_id,
                    settlement_token: entry.quote_token,
                    settlement_amount: equity,
                },
            );
        }

        fn liquidate(
            ref self: ContractState,
            position_id: felt252,
            side: u8,
            size: u128,
            entry_price: u128,
            margin: u128,
            leverage: u8,
            salt: felt252,
        ) {
            let entry = self.open_and_verified(position_id, side, size, entry_price, margin, leverage, salt);

            let price = self.price_of(entry);
            assert(
                is_breached(side, size, entry_price, margin, price), errors::NOT_LIQUIDATABLE,
            );

            // A breach means the loss has eaten past the maintenance threshold. Residual equity
            // (if any) settles to the owner; there is no separate liquidator reward in this
            // version — documented in SECURITY_ASSUMPTIONS.
            let residual = equity_of(side, size, entry_price, margin, price);

            let mut closed = entry;
            closed.liquidated = true;
            self.settle_entry(position_id, closed, residual);
            self.emit(
                PositionLiquidated {
                    position_id, settlement_token: entry.quote_token, residual_to_owner: residual,
                },
            );
        }

        fn is_liquidatable(
            self: @ContractState,
            position_id: felt252,
            side: u8,
            size: u128,
            entry_price: u128,
            margin: u128,
            leverage: u8,
            salt: felt252,
        ) -> bool {
            let entry = self.positions.read(position_id);
            assert(entry.commitment.is_non_zero(), errors::POSITION_NOT_FOUND);
            assert(entry.open, errors::NOT_OPEN);
            assert(
                compute_position_commitment(side, size, entry_price, margin, leverage, salt)
                    == entry.commitment,
                errors::COMMITMENT_MISMATCH,
            );
            let price = self.price_of(entry);
            is_breached(side, size, entry_price, margin, price)
        }

        fn get_position(self: @ContractState, position_id: felt252) -> PositionEntry {
            self.positions.read(position_id)
        }

        fn is_open(self: @ContractState, position_id: felt252) -> bool {
            self.positions.read(position_id).open
        }

        fn get_settlement(self: @ContractState, position_id: felt252) -> (ContractAddress, u128) {
            (self.settlement_token.read(position_id), self.settlement_amount.read(position_id))
        }

        fn oracle(self: @ContractState) -> ContractAddress {
            self.oracle.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Loads an open position and asserts the revealed values match its commitment and its
        /// leverage is a supported tier. The single gate every action passes through.
        fn open_and_verified(
            self: @ContractState,
            position_id: felt252,
            side: u8,
            size: u128,
            entry_price: u128,
            margin: u128,
            leverage: u8,
            salt: felt252,
        ) -> PositionEntry {
            let entry = self.positions.read(position_id);
            assert(entry.commitment.is_non_zero(), errors::POSITION_NOT_FOUND);
            assert(entry.open, errors::NOT_OPEN);
            assert(size.is_non_zero(), errors::ZERO_SIZE);
            assert(margin.is_non_zero(), errors::ZERO_MARGIN);
            assert(entry_price.is_non_zero(), errors::ZERO_ENTRY);
            assert(leverage != 0 && leverage <= MAX_LEVERAGE, errors::BAD_LEVERAGE);
            assert(
                compute_position_commitment(side, size, entry_price, margin, leverage, salt)
                    == entry.commitment,
                errors::COMMITMENT_MISMATCH,
            );
            entry
        }

        fn price_of(self: @ContractState, entry: PositionEntry) -> u128 {
            IPriceOracleDispatcher { contract_address: self.oracle.read() }
                .get_price(entry.base_token, entry.quote_token)
        }

        fn settle(ref self: ContractState, position_id: felt252, entry: PositionEntry, amount: u128) {
            let mut closed = entry;
            closed.open = false;
            self.positions.write(position_id, closed);
            self.settlement_token.write(position_id, entry.quote_token);
            self.settlement_amount.write(position_id, amount);
        }

        /// As `settle`, but for a caller that has already flipped `liquidated` on the entry.
        fn settle_entry(ref self: ContractState, position_id: felt252, mut entry: PositionEntry, amount: u128) {
            entry.open = false;
            self.positions.write(position_id, entry);
            self.settlement_token.write(position_id, entry.quote_token);
            self.settlement_amount.write(position_id, amount);
        }
    }

    /// Quote value of `size` base units at `price` (both scaled), narrowed with an explicit
    /// error so a silent truncation can never mint or burn value.
    fn quote_value(size: u128, price: u128) -> u128 {
        let product: u256 = size.into() * price.into();
        (product / PRICE_SCALE).try_into().expect(errors::VALUE_OVERFLOW)
    }

    /// The position's loss, in quote, or zero if it is in profit. No signed arithmetic: profit
    /// and loss are separated by which value is larger.
    fn loss_of(side: u8, size: u128, entry_price: u128, price: u128) -> u128 {
        let entry_value = quote_value(size, entry_price);
        let current_value = quote_value(size, price);
        if side == SIDE_BUY {
            // Long: loses when the market falls below entry.
            if current_value >= entry_value {
                0
            } else {
                entry_value - current_value
            }
        } else {
            // Short: loses when the market rises above entry.
            if current_value <= entry_value {
                0
            } else {
                current_value - entry_value
            }
        }
    }

    /// Equity = margin + PnL, floored at zero. When in loss, equity = margin − loss (or zero if
    /// the loss exceeds margin). When in profit, this returns at least the margin; profit above
    /// margin is included via the symmetric gain, computed here as the mirror of loss.
    fn equity_of(side: u8, size: u128, entry_price: u128, margin: u128, price: u128) -> u128 {
        let loss = loss_of(side, size, entry_price, price);
        if loss > 0 {
            if loss >= margin {
                0
            } else {
                margin - loss
            }
        } else {
            // In profit: gain is the mirror image of the loss computation with sides swapped.
            let gain = loss_of(opposite(side), size, entry_price, price);
            margin + gain
        }
    }

    /// Maintenance breach: the loss has consumed more than (100% − maintenance%) of the margin,
    /// i.e. equity has fallen below the maintenance fraction of posted margin.
    fn is_breached(side: u8, size: u128, entry_price: u128, margin: u128, price: u128) -> bool {
        let loss = loss_of(side, size, entry_price, price);
        if loss == 0 {
            return false; // in profit, never liquidatable
        }
        let equity = if loss >= margin {
            0
        } else {
            margin - loss
        };
        let maintenance = margin * MAINTENANCE_BPS / BPS_DENOMINATOR;
        equity < maintenance
    }

    fn opposite(side: u8) -> u8 {
        if side == SIDE_BUY {
            SIDE_SELL
        } else {
            SIDE_BUY
        }
    }
}
