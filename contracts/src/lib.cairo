//! MarginGuard — a privacy-preserving trading venue built on STRK20 shielded notes.
//!
//! Phase 1 (foundation) ships four things:
//!   * `commitments` — domain-separated Poseidon commitments, following the STRK20 tag convention
//!   * `types`       — shared value types, kept free of storage concerns
//!   * `agent_registry` — registered agent identities, policy bounds, STARK-curve signature checks
//!   * `order_book`  — resting orders whose public state is only `live` / `matched` flags
//!
//! Design constraints that shape all of this are recorded in `docs/ARCHITECTURE_REPORT.md`.
//! The two that matter most here:
//!
//!   C2  There is no user-supplied circuit. STRK20 proves *pool transactions* over a fixed
//!       action set; an app cannot add a circuit to that proof. Every guarantee below is
//!       therefore enforced by *contract* logic, never by a circuit.
//!   C3  Hidden values cannot be compared on-chain. Orders rest as commitments and are
//!       revealed to the contract at match time, which re-derives the commitment before
//!       evaluating the crossing condition in the clear.

pub mod commitments;
pub mod types;

pub mod agent_registry;
pub mod order_book;

#[cfg(test)]
mod tests;
