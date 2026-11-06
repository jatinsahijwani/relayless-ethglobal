// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.28;

import {Test, stdJson} from "forge-std/Test.sol";
import {RelaylessNameClaimer, IClaimRegistry} from "../src/RelaylessNameClaimer.sol";

struct Grant {
    address account;
    uint256 roleBitmap;
}

interface IFactory {
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address);
}

interface IRegistryV2 {
    function register(string calldata label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) external returns (uint256);
    function setResolver(uint256 anyId, address resolver) external;
    function setSubregistry(uint256 anyId, address registry) external;
    function unregister(uint256 anyId) external;
    function setParent(address parent, string calldata label) external;
    function renew(uint256 anyId, uint64 newExpiry) external;
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function isEmancipated() external view returns (bool);
    function getResolver(string calldata label) external view returns (address);
    function findTokenId(string calldata label) external view returns (uint256);
    function getExpiry(uint256 anyId) external view returns (uint64);
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
    function ownerOf(uint256 id) external view returns (address);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
}

interface IResolverV2 {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata value) external;
    function setContenthash(bytes calldata name, bytes calldata hash) external;
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    function multicall(bytes[] calldata calls) external returns (bytes[] memory);
}

interface IRegistrar {
    function makeCommitment(string calldata label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) external pure returns (bytes32);
    function commit(bytes32 commitment) external;
    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken) external view returns (uint256 base, uint256 premium);
    function register(string calldata label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) external returns (uint256);
}

interface IMockUsdc {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniversalResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory, address);
}

/// @notice Runs the real setup against forked Sepolia, so these are the deployed ENSv2 contracts and not mocks.
contract DirectoryTest is Test {
    using stdJson for string;

    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_SET_PARENT = 1 << 8;
    uint256 constant ROLE_UNREGISTER = 1 << 12;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 constant ROLE_UPGRADE = 1 << 124;
    uint256 constant FULL = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes4 constant UNAUTHORIZED = bytes4(keccak256("EACUnauthorizedAccountRoles(uint256,uint256,address)"));

    string constant ROOT_KEY = "asp.root";
    string constant SLOT_KEY = "asp.slot";
    string constant POLICY_KEY = "asp.policy";
    string constant POOL_KEY = "asp.pool";
    string constant STEALTH_KEY = "stealth-meta-address";

    address curator = makeAddr("relayless-curator");
    address aspOwner = makeAddr("relayless-asp-owner");
    address operator = makeAddr("relayless-operator");
    address alice = makeAddr("relayless-alice");
    address app = makeAddr("relayless-app");
    address stranger = makeAddr("relayless-stranger");

    IFactory factory;
    address registryImpl;
    address resolverImpl;
    IRegistrar registrar;
    IMockUsdc usdc;
    IUniversalResolver ur;
    IRegistryV2 ethRegistry;

    IRegistryV2 r1;
    IRegistryV2 r2;
    RelaylessNameClaimer claimer;
    IResolverV2 aspResolver;
    IResolverV2 aliceResolver;
    bytes worldName;
    bytes aliceName;
    uint64 parentExpiry;

    // A label nobody could have registered on Sepolia, so the fork test keeps working once the real name exists.
    string parentLabel;

    function setUp() public {
        string memory cfg = vm.readFile("../../config/ens.sepolia.json");
        vm.createSelectFork(cfg.readString(".rpc"));
        factory = IFactory(cfg.readAddress(".contracts.verifiableFactory"));
        registryImpl = cfg.readAddress(".contracts.userRegistryImpl");
        resolverImpl = cfg.readAddress(".contracts.permissionedResolverImpl");
        registrar = IRegistrar(cfg.readAddress(".contracts.ethRegistrar"));
        usdc = IMockUsdc(cfg.readAddress(".contracts.mockUsdc"));
        ur = IUniversalResolver(cfg.readAddress(".contracts.universalResolver"));
        ethRegistry = IRegistryV2(cfg.readAddress(".contracts.ethRegistry"));
        parentLabel = string.concat("rl-fork-", vm.toString(uint256(keccak256(abi.encode(block.number, address(this)))) % 1e12));

        // Same order as scripts/ens/setup.ts.
        vm.startPrank(curator);
        r1 = deployRegistry("r1", ROLE_REGISTRAR | ROLE_SET_PARENT | (ROLE_REGISTRAR << 128) | (ROLE_SET_PARENT << 128));
        r2 = deployRegistry("r2", ROLE_REGISTRAR | ROLE_RENEW | ROLE_SET_PARENT | (ROLE_SET_PARENT << 128));
        vm.stopPrank();

        registerParent();

        claimer = new RelaylessNameClaimer(IClaimRegistry(address(r1)));

        vm.startPrank(curator);
        r1.setParent(address(ethRegistry), parentLabel);
        r1.register("asp", curator, address(r2), address(0), ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128), type(uint64).max);
        r2.setParent(address(r1), "asp");
        r1.grantRootRoles(ROLE_REGISTRAR, address(claimer));
        r1.revokeRootRoles(ROLE_REGISTRAR | ROLE_SET_PARENT | (ROLE_REGISTRAR << 128) | (ROLE_SET_PARENT << 128), curator);
        r2.revokeRootRoles(ROLE_SET_PARENT | (ROLE_SET_PARENT << 128), curator);
        vm.stopPrank();

        worldName = dns("world", "asp", parentLabel);
        aliceName = dns2("alice", parentLabel);

        // The ASP's owner deploys its resolver and gives the operator exactly three text keys.
        vm.startPrank(aspOwner);
        aspResolver = deployResolver(aspOwner);
        aspResolver.setText(worldName, POOL_KEY, "0xpool");
        grantText(aspResolver, ROOT_KEY, operator);
        grantText(aspResolver, SLOT_KEY, operator);
        grantText(aspResolver, POLICY_KEY, operator);
        vm.stopPrank();

        // Non-transferable: the owner gets ROLE_SET_RESOLVER, but no transfer role and no way to unregister.
        vm.prank(curator);
        r2.register("world", aspOwner, address(0), address(aspResolver), ROLE_SET_RESOLVER, uint64(block.timestamp + 365 days));

        vm.startPrank(alice);
        aliceResolver = deployResolver(alice);
        claimer.claim("alice", address(aliceResolver));
        aliceResolver.setText(aliceName, "avatar", "alice.png");
        grantText(aliceResolver, STEALTH_KEY, app);
        vm.stopPrank();
    }

    function test_setup_resolvesThroughTheUniversalResolver() public {
        vm.prank(operator);
        aspResolver.setText(worldName, ROOT_KEY, "0xabc");
        assertEq(textOf(worldName, ROOT_KEY), "0xabc");

        vm.prank(app);
        aliceResolver.setText(aliceName, STEALTH_KEY, "st:eth:0x01");
        assertEq(textOf(aliceName, STEALTH_KEY), "st:eth:0x01");
    }

    function test_registries_areEmancipated() public view {
        assertTrue(r1.isEmancipated(), "r1");
        assertTrue(r2.isEmancipated(), "r2");
        assertFalse(r1.hasRootRoles(ROLE_UPGRADE, curator));
        assertFalse(r2.hasRootRoles(ROLE_UPGRADE, curator));
        assertFalse(r1.hasRootRoles(ROLE_REGISTRAR, curator), "curator gave up r1");
    }

    // ---- Feature A: what the curator can't do ----

    function test_curator_cannotEditAnAspRoot() public {
        vm.prank(operator);
        aspResolver.setText(worldName, ROOT_KEY, "0xreal");
        vm.prank(curator);
        vm.expectPartialRevert(UNAUTHORIZED);
        aspResolver.setText(worldName, ROOT_KEY, "0xforged");
        assertEq(textOf(worldName, ROOT_KEY), "0xreal");
    }

    function test_curator_cannotRepointRemoveOrReplaceAnAsp() public {
        uint256 id = r2.findTokenId("world");
        vm.startPrank(curator);
        vm.expectPartialRevert(UNAUTHORIZED);
        r2.setResolver(id, stranger);
        vm.expectPartialRevert(UNAUTHORIZED);
        r2.setSubregistry(id, stranger);
        vm.expectPartialRevert(UNAUTHORIZED);
        r2.unregister(id);
        vm.expectRevert();
        r2.register("world", curator, address(0), stranger, FULL, type(uint64).max);
        vm.expectRevert();
        r2.grantRootRoles(ROLE_SET_RESOLVER, curator);
        vm.stopPrank();
        assertEq(r2.getResolver("world"), address(aspResolver));
    }

    /// @dev Documents the curator's one removal power: stop renewing. It can also re-register after expiry, which is
    /// why clients check the operator against the pool's ASP_SOURCE_ID rather than trusting the name.
    function test_curator_canOnlyRemoveByNotRenewing() public {
        uint256 id = r2.findTokenId("world");
        uint64 expiry = r2.getExpiry(id);
        vm.warp(expiry + 1);
        assertEq(r2.getResolver("world"), address(0), "dark after expiry");
        vm.prank(curator);
        r2.register("world", curator, address(0), stranger, 0, type(uint64).max);
        assertEq(r2.getResolver("world"), stranger);
    }

    function test_parentNameHolder_canStillSwapTheDirectory_untilRoleIsRevoked() public {
        uint256 id = r1.findTokenId("asp");
        vm.prank(curator);
        r1.setSubregistry(id, stranger);
    }

    // ---- Feature A: the operator's limits ----

    function test_operator_editsOnlyItsKeys() public {
        vm.startPrank(operator);
        aspResolver.setText(worldName, ROOT_KEY, "0x1");
        aspResolver.setText(worldName, SLOT_KEY, "7");
        aspResolver.setText(worldName, POLICY_KEY, "unique human");

        vm.expectPartialRevert(UNAUTHORIZED);
        aspResolver.setText(worldName, POOL_KEY, "0xother");
        vm.expectPartialRevert(UNAUTHORIZED);
        aspResolver.setAddress(worldName, 60, abi.encodePacked(operator));
        vm.expectPartialRevert(UNAUTHORIZED);
        aspResolver.setContenthash(worldName, hex"01");
        vm.expectRevert();
        aspResolver.grantRootRoles(ROLE_SET_RESOLVER, operator);
        uint256 id = r2.findTokenId("world");
        vm.expectPartialRevert(UNAUTHORIZED);
        r2.setResolver(id, operator);
        vm.stopPrank();
    }

    function test_operator_multicallKeepsTheCaller() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IResolverV2.setText, (worldName, ROOT_KEY, "0x2"));
        calls[1] = abi.encodeCall(IResolverV2.setText, (worldName, SLOT_KEY, "8"));
        vm.prank(operator);
        aspResolver.multicall(calls);
        assertEq(textOf(worldName, ROOT_KEY), "0x2");
        assertEq(textOf(worldName, SLOT_KEY), "8");

        vm.prank(stranger);
        vm.expectPartialRevert(UNAUTHORIZED);
        aspResolver.multicall(calls);
    }

    function test_aspName_isNonTransferable() public {
        uint256 id = r2.findTokenId("world");
        vm.prank(aspOwner);
        vm.expectRevert();
        r2.safeTransferFrom(aspOwner, stranger, id, 1, "");
    }

    function test_aspOwner_canReplaceItsOwnResolver() public {
        uint256 id = r2.findTokenId("world");
        vm.prank(aspOwner);
        r2.setResolver(id, stranger);
        assertEq(r2.getResolver("world"), stranger);
    }

    // ---- Feature B ----

    function test_appKey_editsOnlyTheStealthRecord() public {
        vm.startPrank(app);
        aliceResolver.setText(aliceName, STEALTH_KEY, "st:eth:0x02");

        vm.expectPartialRevert(UNAUTHORIZED);
        aliceResolver.setText(aliceName, "avatar", "evil.png");
        vm.expectPartialRevert(UNAUTHORIZED);
        aliceResolver.setText(aliceName, "url", "https://evil");
        vm.expectPartialRevert(UNAUTHORIZED);
        aliceResolver.setAddress(aliceName, 60, abi.encodePacked(app));
        vm.expectPartialRevert(UNAUTHORIZED);
        aliceResolver.setContenthash(aliceName, hex"01");
        vm.expectRevert();
        aliceResolver.grantRootRoles(ROLE_SET_RESOLVER, app);
        // Holding the role doesn't include granting it onward.
        vm.expectRevert();
        aliceResolver.grantSetterRoles(abi.encodeCall(IResolverV2.setText, (bytes(""), STEALTH_KEY, "")), stranger);

        uint256 id = r1.findTokenId("alice");
        vm.expectPartialRevert(UNAUTHORIZED);
        r1.setResolver(id, app);
        vm.expectRevert();
        r1.safeTransferFrom(alice, app, id, 1, "");
        vm.stopPrank();
        assertEq(textOf(aliceName, "avatar"), "alice.png");
    }

    function test_alice_canRevokeTheAppKey() public {
        vm.prank(alice);
        aliceResolver.revokeRoles(uint256(keccak256(bytes(STEALTH_KEY))), 1 << 4, app);
        vm.prank(app);
        vm.expectPartialRevert(UNAUTHORIZED);
        aliceResolver.setText(aliceName, STEALTH_KEY, "st:eth:0x03");
    }

    function test_name_isOwnedOutright() public {
        uint256 id = r1.findTokenId("alice");
        assertEq(r1.getExpiry(id), type(uint64).max);
        vm.startPrank(curator);
        vm.expectPartialRevert(UNAUTHORIZED);
        r1.setResolver(id, curator);
        vm.expectPartialRevert(UNAUTHORIZED);
        r1.unregister(id);
        vm.expectRevert();
        r1.register("alice", curator, address(0), curator, 0, type(uint64).max);
        vm.expectRevert();
        r1.grantRootRoles(ROLE_REGISTRAR, curator);
        vm.stopPrank();

        // Nor can Alice release it, so it can't be released and reclaimed by someone else.
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTHORIZED);
        r1.unregister(id);
    }

    function test_claim_cannotTakeATakenName() public {
        vm.prank(stranger);
        vm.expectRevert();
        claimer.claim("alice", stranger);
        vm.prank(stranger);
        vm.expectRevert();
        claimer.claim("asp", stranger);
    }

    function test_alice_transfersHerNameAndRolesFollow() public {
        uint256 before = r1.findTokenId("alice");
        vm.prank(alice);
        r1.safeTransferFrom(alice, stranger, before, 1, "");
        uint256 id = r1.findTokenId("alice");
        assertEq(r1.ownerOf(id), stranger);
        vm.prank(stranger);
        r1.setResolver(id, address(0x1234));
        assertEq(r1.getResolver("alice"), address(0x1234));
    }

    /// @dev A forever name is only forever inside its registry. If the parent expires, resolution stops.
    function test_foreverName_stillDependsOnTheParentName() public {
        assertEq(textOf(aliceName, "avatar"), "alice.png");
        vm.warp(parentExpiry + 90 days);
        vm.expectRevert();
        ur.resolve(aliceName, textCall(aliceName, "avatar"));
    }

    // ---- Helpers ----

    function registerParent() internal {
        uint64 duration = 365 days;
        bytes32 secret = keccak256("secret");
        (uint256 base, uint256 premium) = registrar.getRegisterPrice(parentLabel, duration, address(usdc));
        vm.startPrank(curator);
        usdc.mint(curator, base + premium);
        usdc.approve(address(registrar), base + premium);
        registrar.commit(registrar.makeCommitment(parentLabel, curator, secret, address(r1), address(0), duration, bytes32(0)));
        vm.warp(block.timestamp + 61);
        vm.roll(block.number + 5);
        registrar.register(parentLabel, curator, secret, address(r1), address(0), duration, address(usdc), bytes32(0));
        vm.stopPrank();
        parentExpiry = uint64(block.timestamp) + duration;
    }

    function deployRegistry(string memory salt, uint256 roles) internal returns (IRegistryV2) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(curator, roles);
        bytes memory init = abi.encodeWithSignature("initialize((address,uint256)[])", grants);
        return IRegistryV2(factory.deployProxy(registryImpl, uint256(keccak256(bytes(salt))), init));
    }

    function deployResolver(address owner) internal returns (IResolverV2) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(owner, FULL);
        bytes memory init = abi.encodeWithSignature("initialize((address,uint256)[],bytes[])", grants, new bytes[](0));
        return IResolverV2(factory.deployProxy(resolverImpl, uint256(keccak256(abi.encode(owner))), init));
    }

    function grantText(IResolverV2 resolver, string memory key, address account) internal {
        resolver.grantSetterRoles(abi.encodeCall(IResolverV2.setText, (bytes(""), key, "")), account);
    }

    function textCall(bytes memory name, string memory key) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("text(bytes32,string)", namehashOf(name, 0), key);
    }

    function textOf(bytes memory name, string memory key) internal view returns (string memory) {
        (bytes memory out,) = ur.resolve(name, textCall(name, key));
        return abi.decode(out, (string));
    }

    function namehashOf(bytes memory name, uint256 at) internal pure returns (bytes32) {
        uint256 len = uint8(name[at]);
        if (len == 0) return bytes32(0);
        bytes memory label = new bytes(len);
        for (uint256 i; i < len; i++) label[i] = name[at + 1 + i];
        return keccak256(abi.encodePacked(namehashOf(name, at + 1 + len), keccak256(label)));
    }

    function dns(string memory a, string memory b, string memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(a).length), a, dns2(b, c));
    }

    function dns2(string memory a, string memory b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(a).length), a, uint8(bytes(b).length), b, uint8(3), "eth", uint8(0));
    }
}
