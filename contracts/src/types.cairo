//! Shared value types.
//!
//! Storage-facing enums are deliberately avoided: side and proposal kind are carried as `u8`
//! in storage and validated on the way in. The escrow reference helper in the STRK20 docs
//! uses the same split (plain enums for the `Serde` calldata surface, plain scalars in
//! storage), and it keeps the `Store` derive surface small.

/// Order side, as it appears in calldata. Stored as `u8` via `side_to_u8`.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum Side {
    Buy,
    Sell,
}

pub const SIDE_BUY: u8 = 0;
pub const SIDE_SELL: u8 = 1;

pub fn side_to_u8(side: Side) -> u8 {
    match side {
        Side::Buy => SIDE_BUY,
        Side::Sell => SIDE_SELL,
    }
}

pub fn side_from_u8(raw: u8) -> Side {
    if raw == SIDE_BUY {
        Side::Buy
    } else {
        Side::Sell
    }
}

/// The risk actions a registered agent may propose. The agent proposes; the contract verifies
/// and enforces. Nothing here grants the agent custody or direct state access.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum ProposalKind {
    /// Add margin to a position, improving its health.
    IncreaseMargin,
    /// Reduce position size, lowering exposure.
    ReduceSize,
    /// Lower effective leverage.
    AdjustLeverage,
    /// Close the position outright.
    ClosePosition,
}

pub const KIND_INCREASE_MARGIN: u8 = 0;
pub const KIND_REDUCE_SIZE: u8 = 1;
pub const KIND_ADJUST_LEVERAGE: u8 = 2;
pub const KIND_CLOSE_POSITION: u8 = 3;

pub fn kind_to_u8(kind: ProposalKind) -> u8 {
    match kind {
        ProposalKind::IncreaseMargin => KIND_INCREASE_MARGIN,
        ProposalKind::ReduceSize => KIND_REDUCE_SIZE,
        ProposalKind::AdjustLeverage => KIND_ADJUST_LEVERAGE,
        ProposalKind::ClosePosition => KIND_CLOSE_POSITION,
    }
}

/// Policy bounds an agent is held to. Every field is an upper bound the contract enforces;
/// an agent can always propose something weaker, never something stronger.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct AgentPolicy {
    /// Largest single margin top-up, in basis points of the position's initial margin.
    pub max_margin_increase_bps: u16,
    /// Largest single size reduction, in basis points of current size.
    pub max_size_reduction_bps: u16,
    /// Highest leverage the agent may leave a position at.
    pub max_leverage: u8,
    /// Whether the agent is permitted to propose a full close.
    pub may_close: bool,
}

/// A registered agent. `public_key` is a STARK-curve public key; proposals are verified
/// against it with `check_ecdsa_signature`.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct AgentEntry {
    pub public_key: felt252,
    pub active: bool,
    pub policy: AgentPolicy,
    /// Monotonic per-agent counter, bound into every signed proposal to prevent replay (T6).
    pub nonce: u64,
}

/// A resting order.
///
/// Public state is deliberately limited to the flags and the token pair. Side, price and size
/// live only inside `commitment` until the order is revealed at match time — see C3 in the
/// architecture report.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct OrderEntry {
    /// `poseidon(TRADER_TAG, owner_secret)` — binds the order to a claimant without naming one.
    pub trader_commitment: felt252,
    /// `poseidon(ORDER_TAG, side, price, size, salt)`.
    pub commitment: felt252,
    pub base_token: starknet::ContractAddress,
    pub quote_token: starknet::ContractAddress,
    /// True once placed, false once matched or cancelled.
    pub live: bool,
    /// True once the matching engine has paired this order.
    pub matched: bool,
    /// True once the owner has claimed the proceeds into an open note.
    pub claimed: bool,
}

/// A perpetual position.
///
/// Like an order, only the commitments, the market, and the lifecycle flags are public. Side,
/// size, entry price, margin and leverage live inside `commitment` and are revealed to the
/// contract only when an action must evaluate the position — see the PerpEngine module docs.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct PositionEntry {
    /// `poseidon(TRADER_TAG, owner_secret)` — binds the owner without naming an address.
    pub trader_commitment: felt252,
    /// `poseidon(POSITION_TAG, side, size, entry_price, margin, leverage, salt)`.
    pub commitment: felt252,
    pub base_token: starknet::ContractAddress,
    pub quote_token: starknet::ContractAddress,
    /// True while the position is live; false once closed or liquidated.
    pub open: bool,
    /// True if the position was closed by liquidation rather than by its owner.
    pub liquidated: bool,
}
