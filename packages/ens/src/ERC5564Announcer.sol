// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.28;

/// @notice The ERC-5564 announcer interface, for chains with no canonical deployment such as our devnet.
/// Anyone may announce anything, so scanners must treat every entry as untrusted.
contract ERC5564Announcer {
    event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata);

    function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
