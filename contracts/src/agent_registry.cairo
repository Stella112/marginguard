//! Agent registry and proposal verification.
//!
//! The trust model, stated exactly: **the agent proposes, the contract verifies, the contract
//! enforces.** An agent is a STARK-curve keypair plus a set of policy bounds. It signs
//! proposals off-chain. It holds no funds, holds no user key, and cannot write state here —
//! every entry point below either reads, or is gated on a signature the contract checks itself.
//!
//! Note on wording: the architecture report's C2 records that STRK20 exposes no user-supplied
//! circuit, so verification is contract-enforced rather than circuit-enforced. Nothing in this
//! file claims otherwise.

use starknet::ContractAddress;
use crate::types::AgentPolicy;

#[starknet::interface]
pub trait IAgentRegistry<T> {
    /// Registers the caller as an agent under `public_key`, bounded by `policy`.
    /// An address may hold one registration; re-registering requires revoking first.
    fn register_agent(ref self: T, public_key: felt252, policy: AgentPolicy);

    /// Deactivates the caller's registration. Idempotent for an already-inactive agent,
    /// and callable only by the agent itself.
    fn revoke_agent(ref self: T);

    /// True only when `agent` is registered *and* active.
    fn is_registered_agent(self: @T, agent: ContractAddress) -> bool;

    /// The agent's registered public key, or 0 if never registered.
    fn agent_public_key(self: @T, agent: ContractAddress) -> felt252;

    /// The agent's policy bounds. All-zero if never registered.
    fn agent_policy(self: @T, agent: ContractAddress) -> AgentPolicy;

    /// The next nonce the agent must bind into a signed proposal.
    fn agent_nonce(self: @T, agent: ContractAddress) -> u64;

    /// Verifies a signed proposal without consuming the nonce. Pure read — used by the
    /// frontend and by the off-chain agent to dry-run before submitting.
    ///
    /// Checks, in order: the agent is registered and active, the signature is valid over
    /// `compute_proposal_digest(...)` under the registered key, and the proposal sits within
    /// the agent's policy bounds. Position-state validity is checked by the perp engine at
    /// execution time, since only it holds the position.
    fn verify_proposal(
        self: @T,
        agent: ContractAddress,
        position_id: felt252,
        kind: u8,
        value: u128,
        nonce: u64,
        signature_r: felt252,
        signature_s: felt252,
    ) -> bool;

    /// Binds the registry to the one executor allowed to consume proposals — the perp engine.
    /// One-time, like the order book's venue binding: the engine's constructor takes the
    /// registry, so they cannot both know each other at deployment. Done immediately after
    /// deploy.
    fn initialize_executor(ref self: T, executor: ContractAddress);

    /// The mutating counterpart to `verify_proposal`: runs the identical checks and, on
    /// success, **burns the nonce** so the proposal can never be replayed (threat T6). Reverts
    /// with a specific error on any failed check, so the calling perp action aborts atomically.
    ///
    /// Restricted to the bound executor. This matters: the nonce burn and the position state
    /// change must happen in one transaction, or a griefer could replay a signed proposal to
    /// desync the nonce from the engine. Only the engine calls this, inside its own adjustment.
    fn consume_proposal(
        ref self: T,
        agent: ContractAddress,
        position_id: felt252,
        kind: u8,
        value: u128,
        nonce: u64,
        signature_r: felt252,
        signature_s: felt252,
    );

    fn executor(self: @T) -> ContractAddress;
}

pub mod errors {
    pub const ZERO_PUBLIC_KEY: felt252 = 'ZERO_PUBLIC_KEY';
    pub const ALREADY_REGISTERED: felt252 = 'ALREADY_REGISTERED';
    pub const NOT_REGISTERED: felt252 = 'NOT_REGISTERED';
    pub const ZERO_MAX_LEVERAGE: felt252 = 'ZERO_MAX_LEVERAGE';
    pub const BPS_OUT_OF_RANGE: felt252 = 'BPS_OUT_OF_RANGE';
    pub const LEVERAGE_TOO_HIGH: felt252 = 'LEVERAGE_TOO_HIGH';
    pub const ZERO_EXECUTOR: felt252 = 'ZERO_EXECUTOR';
    pub const EXECUTOR_ALREADY_SET: felt252 = 'EXECUTOR_ALREADY_SET';
    pub const NOT_EXECUTOR: felt252 = 'NOT_EXECUTOR';
    // consume_proposal rejection reasons — specific so the engine's revert says why.
    pub const AGENT_INACTIVE: felt252 = 'AGENT_INACTIVE';
    pub const STALE_NONCE: felt252 = 'STALE_NONCE';
    pub const SIG_INVALID: felt252 = 'SIG_INVALID';
    pub const POLICY_VIOLATION: felt252 = 'POLICY_VIOLATION';
}

/// Basis-point denominator. A bound above this would allow more than a 100% move.
pub const BPS_DENOMINATOR: u16 = 10000;

/// Highest leverage the venue supports at all, independent of any agent policy.
/// The brief fixes the tiers at 2x / 5x / 10x.
pub const MAX_SUPPORTED_LEVERAGE: u8 = 10;

#[starknet::contract]
pub mod AgentRegistry {
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use crate::commitments::compute_proposal_digest;
    use crate::types::{
        AgentEntry, AgentPolicy, KIND_ADJUST_LEVERAGE, KIND_CLOSE_POSITION, KIND_INCREASE_MARGIN,
        KIND_REDUCE_SIZE,
    };
    use super::{BPS_DENOMINATOR, IAgentRegistry, MAX_SUPPORTED_LEVERAGE, errors};

    #[storage]
    struct Storage {
        agents: Map<ContractAddress, AgentEntry>,
        /// The perp engine, the only address allowed to consume proposals.
        executor: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AgentRegistered: AgentRegistered,
        AgentRevoked: AgentRevoked,
    }

    /// Agent identity and action type are public by design — see the public/shielded split
    /// in the architecture report. Only position economics stay hidden.
    #[derive(Drop, starknet::Event)]
    pub struct AgentRegistered {
        #[key]
        pub agent: ContractAddress,
        pub public_key: felt252,
        pub max_leverage: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentRevoked {
        #[key]
        pub agent: ContractAddress,
    }

    #[abi(embed_v0)]
    pub impl AgentRegistryImpl of IAgentRegistry<ContractState> {
        fn register_agent(ref self: ContractState, public_key: felt252, policy: AgentPolicy) {
            assert(public_key.is_non_zero(), errors::ZERO_PUBLIC_KEY);
            validate_policy(policy);

            let agent = get_caller_address();
            let existing = self.agents.read(agent);
            assert(!existing.active, errors::ALREADY_REGISTERED);

            // A re-registration after revocation keeps counting from the old nonce, so a
            // proposal signed under a previous key can never become valid again.
            self
                .agents
                .write(
                    agent, AgentEntry { public_key, active: true, policy, nonce: existing.nonce },
                );

            self
                .emit(
                    AgentRegistered { agent, public_key, max_leverage: policy.max_leverage },
                );
        }

        fn revoke_agent(ref self: ContractState) {
            let agent = get_caller_address();
            let existing = self.agents.read(agent);
            assert(existing.public_key.is_non_zero(), errors::NOT_REGISTERED);

            self.agents.write(agent, AgentEntry { active: false, ..existing });
            self.emit(AgentRevoked { agent });
        }

        fn is_registered_agent(self: @ContractState, agent: ContractAddress) -> bool {
            let entry = self.agents.read(agent);
            entry.public_key.is_non_zero() && entry.active
        }

        fn agent_public_key(self: @ContractState, agent: ContractAddress) -> felt252 {
            self.agents.read(agent).public_key
        }

        fn agent_policy(self: @ContractState, agent: ContractAddress) -> AgentPolicy {
            self.agents.read(agent).policy
        }

        fn agent_nonce(self: @ContractState, agent: ContractAddress) -> u64 {
            self.agents.read(agent).nonce
        }

        fn verify_proposal(
            self: @ContractState,
            agent: ContractAddress,
            position_id: felt252,
            kind: u8,
            value: u128,
            nonce: u64,
            signature_r: felt252,
            signature_s: felt252,
        ) -> bool {
            let entry = self.agents.read(agent);

            // 1. Registered and active.
            if entry.public_key.is_zero() || !entry.active {
                return false;
            }

            // 2. Fresh — the nonce must be the one the registry expects next (threat T6).
            if nonce != entry.nonce {
                return false;
            }

            // 3. Signed by the registered key over the exact proposal.
            let digest = compute_proposal_digest(position_id, kind, value, nonce);
            if !check_ecdsa_signature(digest, entry.public_key, signature_r, signature_s) {
                return false;
            }

            // 4. Within policy bounds.
            within_policy(entry.policy, kind, value)
        }

        fn initialize_executor(ref self: ContractState, executor: ContractAddress) {
            assert(executor.is_non_zero(), errors::ZERO_EXECUTOR);
            assert(self.executor.read().is_zero(), errors::EXECUTOR_ALREADY_SET);
            self.executor.write(executor);
        }

        fn consume_proposal(
            ref self: ContractState,
            agent: ContractAddress,
            position_id: felt252,
            kind: u8,
            value: u128,
            nonce: u64,
            signature_r: felt252,
            signature_s: felt252,
        ) {
            // Only the bound engine may consume — see the trait doc for why this must be gated.
            let executor = self.executor.read();
            assert(executor.is_non_zero() && get_caller_address() == executor, errors::NOT_EXECUTOR);

            let entry = self.agents.read(agent);

            // Same four checks as verify_proposal, but each asserts with a specific reason so
            // the engine's transaction reverts legibly.
            assert(entry.public_key.is_non_zero() && entry.active, errors::AGENT_INACTIVE);
            assert(nonce == entry.nonce, errors::STALE_NONCE);
            let digest = compute_proposal_digest(position_id, kind, value, nonce);
            assert(
                check_ecdsa_signature(digest, entry.public_key, signature_r, signature_s),
                errors::SIG_INVALID,
            );
            assert(within_policy(entry.policy, kind, value), errors::POLICY_VIOLATION);

            // Burn the nonce. A monotonic bump means this exact proposal can never verify again.
            self.agents.write(agent, AgentEntry { nonce: entry.nonce + 1, ..entry });
        }

        fn executor(self: @ContractState) -> ContractAddress {
            self.executor.read()
        }
    }

    /// Policy bounds are upper limits, so each must be expressible as a fraction of the whole.
    fn validate_policy(policy: AgentPolicy) {
        assert(policy.max_leverage != 0, errors::ZERO_MAX_LEVERAGE);
        assert(policy.max_leverage <= MAX_SUPPORTED_LEVERAGE, errors::LEVERAGE_TOO_HIGH);
        assert(policy.max_margin_increase_bps <= BPS_DENOMINATOR, errors::BPS_OUT_OF_RANGE);
        assert(policy.max_size_reduction_bps <= BPS_DENOMINATOR, errors::BPS_OUT_OF_RANGE);
    }

    /// Bounds check per proposal kind. `value` is interpreted per kind: basis points for
    /// margin and size moves, an absolute leverage figure for `AdjustLeverage`, and unused
    /// for a close.
    fn within_policy(policy: AgentPolicy, kind: u8, value: u128) -> bool {
        if kind == KIND_INCREASE_MARGIN {
            value <= policy.max_margin_increase_bps.into()
        } else if kind == KIND_REDUCE_SIZE {
            value <= policy.max_size_reduction_bps.into()
        } else if kind == KIND_ADJUST_LEVERAGE {
            // An adjustment may only ever lower risk, so it must land at or under the cap
            // and must be a real leverage figure.
            value != 0 && value <= policy.max_leverage.into()
        } else if kind == KIND_CLOSE_POSITION {
            policy.may_close
        } else {
            // Unknown kind — refuse rather than fall through permissively.
            false
        }
    }
}
