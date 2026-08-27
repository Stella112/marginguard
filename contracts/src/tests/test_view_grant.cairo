//! Viewing-key delegation tests (the owner→agent selective-disclosure grant, IDEA-21).
//!
//! The chain is a bulletin board for the ECDH grant material — it stores the ephemeral public
//! key and the masked capability, records which agent, and whether the grant is active. The
//! encryption and decryption are off-chain (STRK20's documented ECDH scheme), so these tests
//! assert the on-chain contract: only the owner may grant or revoke, the grant reads back
//! faithfully, and revocation flips it inactive without erasing the record.

use core::num::traits::Zero;
use starknet::syscalls::deploy_syscall;
use starknet::{ContractAddress, SyscallResultTrait};

use crate::commitments::{compute_position_commitment, compute_trader_commitment};
use crate::perp::{IPerpEngineDispatcher, IPerpEngineDispatcherTrait, PerpEngine};
use crate::types::SIDE_BUY;
use super::mock_oracle::MockOracle;

const SCALE: u128 = 1000000000000000000;
const ENTRY: u128 = 1500 * SCALE;
const SIZE: u128 = 100;
const MARGIN: u128 = 50000;
const LEV: u8 = 2;
const OWNER_SECRET: felt252 = 'perp_owner';
const SALT: felt252 = 'perp_salt';

// Stand-ins for the off-chain ECDH material. Their real values are computed in the wallet;
// on-chain they are opaque felts.
const EPHEMERAL: felt252 = 'rG_ephemeral_pubkey';
const CIPHERTEXT: felt252 = 'masked_capability';

fn agent() -> ContractAddress {
    0xA9E17.try_into().unwrap()
}
fn base() -> ContractAddress {
    0xB45E.try_into().unwrap()
}
fn quote() -> ContractAddress {
    0x9074E.try_into().unwrap()
}

fn setup() -> IPerpEngineDispatcher {
    let (oracle_addr, _) = deploy_syscall(
        MockOracle::TEST_CLASS_HASH.try_into().unwrap(), 0, array![ENTRY.into()].span(), false,
    )
        .unwrap_syscall();
    let (perp_addr, _) = deploy_syscall(
        PerpEngine::TEST_CLASS_HASH.try_into().unwrap(), 0, array![oracle_addr.into()].span(),
        false,
    )
        .unwrap_syscall();
    let perp = IPerpEngineDispatcher { contract_address: perp_addr };
    perp
        .open_position(
            'p1',
            compute_trader_commitment(OWNER_SECRET),
            compute_position_commitment(SIDE_BUY, SIZE, ENTRY, MARGIN, LEV, SALT),
            base(),
            quote(),
        );
    perp
}

#[test]
fn the_owner_can_grant_the_agent_a_scoped_view() {
    let perp = setup();
    perp.grant_view('p1', OWNER_SECRET, agent(), EPHEMERAL, CIPHERTEXT);

    let g = perp.get_view_grant('p1');
    assert(g.agent == agent(), 'agent recorded');
    assert(g.ephemeral == EPHEMERAL, 'ephemeral recorded');
    assert(g.ciphertext == CIPHERTEXT, 'ciphertext recorded');
    assert(g.active, 'grant active');
}

/// Entitlement is the secret. A stranger cannot grant a view on someone's position.
#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET', 'ENTRYPOINT_FAILED'))]
fn a_stranger_cannot_grant() {
    let perp = setup();
    perp.grant_view('p1', 'wrong_secret', agent(), EPHEMERAL, CIPHERTEXT);
}

#[test]
#[should_panic(expected: ('ZERO_AGENT', 'ENTRYPOINT_FAILED'))]
fn cannot_grant_to_the_zero_agent() {
    let perp = setup();
    perp.grant_view('p1', OWNER_SECRET, 0.try_into().unwrap(), EPHEMERAL, CIPHERTEXT);
}

#[test]
#[should_panic(expected: ('POSITION_NOT_FOUND', 'ENTRYPOINT_FAILED'))]
fn cannot_grant_on_a_missing_position() {
    let perp = setup();
    perp.grant_view('nope', OWNER_SECRET, agent(), EPHEMERAL, CIPHERTEXT);
}

#[test]
fn the_owner_can_revoke_the_grant() {
    let perp = setup();
    perp.grant_view('p1', OWNER_SECRET, agent(), EPHEMERAL, CIPHERTEXT);

    perp.revoke_view('p1', OWNER_SECRET);

    let g = perp.get_view_grant('p1');
    // The record survives so history is auditable; only `active` flips.
    assert(!g.active, 'grant inactive');
    assert(g.agent == agent(), 'agent still recorded');
}

#[test]
#[should_panic(expected: ('BAD_OWNER_SECRET', 'ENTRYPOINT_FAILED'))]
fn a_stranger_cannot_revoke() {
    let perp = setup();
    perp.grant_view('p1', OWNER_SECRET, agent(), EPHEMERAL, CIPHERTEXT);
    perp.revoke_view('p1', 'wrong_secret');
}

#[test]
#[should_panic(expected: ('NO_GRANT', 'ENTRYPOINT_FAILED'))]
fn cannot_revoke_when_no_grant_exists() {
    let perp = setup();
    perp.revoke_view('p1', OWNER_SECRET);
}

/// A position with no grant reads back empty — the default is no disclosure.
#[test]
fn a_position_has_no_grant_by_default() {
    let perp = setup();
    let g = perp.get_view_grant('p1');
    assert(g.agent.is_zero(), 'no agent');
    assert(!g.active, 'not active');
}

/// Re-granting after a revoke replaces the material and reactivates — the owner can rotate the
/// agent's view (e.g. after re-committing the position under a fresh salt).
#[test]
fn the_owner_can_regrant_after_revoking() {
    let perp = setup();
    perp.grant_view('p1', OWNER_SECRET, agent(), EPHEMERAL, CIPHERTEXT);
    perp.revoke_view('p1', OWNER_SECRET);
    perp.grant_view('p1', OWNER_SECRET, agent(), 'new_rG', 'new_cipher');

    let g = perp.get_view_grant('p1');
    assert(g.active, 're-activated');
    assert(g.ephemeral == 'new_rG', 'rotated material');
}
