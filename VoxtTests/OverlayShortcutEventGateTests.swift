// OverlayShortcutEventGateTests.swift
// Focused coverage for physical ESC dedup and tap-path ESC routing order.

import XCTest
import AppKit
import Carbon
@testable import Voxt

final class OverlayShortcutEventGateTests: XCTestCase {
    func testClaimPhysicalEscapeMarksFirstAsPrimary() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 1_000)

        XCTAssertEqual(gate.claimPhysicalEscape(now: now), .primary)
    }

    func testClaimPhysicalEscapeDedupsWithinWindowAndKeepsConsumeSemantics() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 1_000)

        XCTAssertEqual(gate.claimPhysicalEscape(now: now), .primary)
        XCTAssertEqual(
            gate.claimPhysicalEscape(now: now.addingTimeInterval(0.05)),
            .duplicate
        )
        XCTAssertEqual(
            gate.claimPhysicalEscape(now: now.addingTimeInterval(0.099)),
            .duplicate
        )
    }

    func testClaimPhysicalEscapeAllowsNewPrimaryAfterDedupWindow() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 1_000)

        XCTAssertEqual(gate.claimPhysicalEscape(now: now), .primary)
        XCTAssertEqual(
            gate.claimPhysicalEscape(
                now: now.addingTimeInterval(OverlayShortcutEventGate.physicalEscapeDedupInterval)
            ),
            .primary
        )
    }

    func testRecentClaimKeepsDuplicateConsumableAfterPrimaryChangesSessionState() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 1_000)

        XCTAssertEqual(gate.claimPhysicalEscape(now: now), .primary)
        XCTAssertTrue(gate.hasRecentPhysicalEscapeClaim(now: now.addingTimeInterval(0.05)))
        XCTAssertFalse(
            gate.hasRecentPhysicalEscapeClaim(
                now: now.addingTimeInterval(OverlayShortcutEventGate.physicalEscapeDedupInterval)
            )
        )
    }

    func testClaimPhysicalEscapeIsThreadSafeUnderContention() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 2_000)
        let group = DispatchGroup()
        let lock = NSLock()
        var claims: [OverlayShortcutEventGate.PhysicalEscapeClaim] = []

        for _ in 0..<16 {
            group.enter()
            DispatchQueue.global(qos: .userInitiated).async {
                let claim = gate.claimPhysicalEscape(now: now)
                lock.lock()
                claims.append(claim)
                lock.unlock()
                group.leave()
            }
        }

        XCTAssertEqual(group.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(claims.filter { $0 == .primary }.count, 1)
        XCTAssertEqual(claims.filter { $0 == .duplicate }.count, 15)
    }

    func testEscapeShortcutRoutingIgnoresWhenNotConsumable() {
        XCTAssertEqual(
            EscapeShortcutRouting.route(shouldConsume: false, claim: .primary),
            .ignore
        )
        XCTAssertEqual(
            EscapeShortcutRouting.route(shouldConsume: false, claim: .duplicate),
            .ignore
        )
    }

    func testEscapeShortcutRoutingPrimaryHandlesAndDuplicateOnlyConsumes() {
        XCTAssertEqual(
            EscapeShortcutRouting.route(shouldConsume: true, claim: .primary),
            .handleAndConsume
        )
        XCTAssertEqual(
            EscapeShortcutRouting.route(shouldConsume: true, claim: .duplicate),
            .consumeDuplicate
        )
    }

    func testSynchronousEscapeCallbackCompletesBeforeFollowingMainQueueWork() {
        // Mirrors HotkeyManager: async callbacks enqueue on main; ESC handler must finish
        // synchronously so a following tap-start sees cancelled session state.
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 3_000)
        var order: [String] = []
        let expectation = expectation(description: "main queue drained")

        DispatchQueue.main.async {
            let claim = gate.claimPhysicalEscape(now: now)
            switch EscapeShortcutRouting.route(shouldConsume: true, claim: claim) {
            case .handleAndConsume:
                order.append("escape-handle")
            case .consumeDuplicate:
                order.append("escape-duplicate")
            case .ignore:
                order.append("escape-ignore")
            }
        }
        DispatchQueue.main.async {
            order.append("tap-start")
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1)
        XCTAssertEqual(order, ["escape-handle", "tap-start"])
    }

    func testDuplicateEscapeFromSecondSourceKeepsConsumeWithoutSecondHandle() {
        let gate = OverlayShortcutEventGate()
        let now = Date(timeIntervalSince1970: 4_000)
        var handleCount = 0
        var consumeCount = 0

        func deliverEscape() {
            let claim = gate.claimPhysicalEscape(now: now)
            switch EscapeShortcutRouting.route(shouldConsume: true, claim: claim) {
            case .ignore:
                break
            case .handleAndConsume:
                handleCount += 1
                consumeCount += 1
            case .consumeDuplicate:
                consumeCount += 1
            }
        }

        // Event tap + NSEvent monitor for the same physical ESC.
        deliverEscape()
        deliverEscape()

        XCTAssertEqual(handleCount, 1)
        XCTAssertEqual(consumeCount, 2)
    }

    func testShouldDispatchStillFiltersRepeatsAndNonOverlayKeys() {
        let gate = OverlayShortcutEventGate()
        XCTAssertTrue(
            gate.shouldDispatch(
                keyCode: UInt16(kVK_Escape),
                modifiers: [],
                isRepeat: false
            )
        )
        XCTAssertFalse(
            gate.shouldDispatch(
                keyCode: UInt16(kVK_Escape),
                modifiers: [],
                isRepeat: true
            )
        )
        XCTAssertFalse(
            gate.shouldDispatch(
                keyCode: UInt16(kVK_ANSI_A),
                modifiers: [],
                isRepeat: false
            )
        )
    }
}
