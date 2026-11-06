// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.28;

interface IClaimRegistry {
    function register(string calldata label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry)
        external
        returns (uint256 tokenId);
}

/// @notice Lets anyone claim a free receive name under a registry that nobody can override, with no server in the way.
///
/// The claimant owns the name outright:
///  - it never expires, so no one can take it back by waiting, and the registry can't re-register a live name;
///  - nobody is given ROLE_UNREGISTER, on the name or at the registry's root;
///  - this contract only ever holds ROLE_REGISTRAR, keeps no admin role, and has no owner or upgrade path.
///
/// Claims are first come, first served with no commit-reveal, so a claim can be front-run. These names are free, which
/// makes that a nuisance rather than a loss.
contract RelaylessNameClaimer {
    uint64 public constant FOREVER = type(uint64).max;

    // Role values from ENS contracts-v2 RegistryRolesLib.
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;

    /// @notice What a claimant gets on their own name. ROLE_UNREGISTER is left out on purpose, so a name can't be
    /// released and then taken by someone else. ROLE_RENEW isn't needed for a name that never expires.
    uint256 public constant OWNER_ROLES = ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128) | ROLE_SET_RESOLVER
        | (ROLE_SET_RESOLVER << 128) | ROLE_CAN_TRANSFER_ADMIN;

    IClaimRegistry public immutable REGISTRY;

    constructor(IClaimRegistry registry) {
        REGISTRY = registry;
    }

    /// @notice Registers `label` to the caller. The registry reverts if it's already taken.
    /// @param resolver The caller's own Permissioned Resolver: resolver roles cover every name on an instance, so names
    /// must not share one.
    function claim(string calldata label, address resolver) external returns (uint256 tokenId) {
        return REGISTRY.register(label, msg.sender, address(0), resolver, OWNER_ROLES, FOREVER);
    }
}
