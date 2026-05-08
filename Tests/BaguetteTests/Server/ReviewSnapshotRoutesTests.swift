import Foundation
import Mockable
import Testing
@testable import Baguette

@Suite("Server review snapshot route")
struct ReviewSnapshotRoutesTests {

    @Test func `reviewSnapshotJSONString returns snapshot metadata screenshot and ax tree`() async throws {
        let sim = Self.simulator()
        let json = try await Server.reviewSnapshotJSONString(
            udid: "UDID-1",
            quality: 0.8,
            scale: 2,
            simulators: Self.simulators(with: sim),
            capture: { _, quality, scale in
                #expect(quality == 0.8)
                #expect(scale == 2)
                return Data("JPEG".utf8)
            },
            describe: { _ in Self.axTree() }
        )

        let parsed = try #require(
            JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        #expect(parsed["snapshotId"] as? String != nil)
        #expect(parsed["createdAt"] as? String != nil)

        let device = try #require(parsed["device"] as? [String: Any])
        #expect(device["name"] as? String == "iPhone 17 Pro")
        #expect(device["runtime"] as? String == "iOS 26.2")
        #expect(device["udid"] as? String == "UDID-1")

        let screen = try #require(parsed["screen"] as? [String: Any])
        #expect(screen["width"] as? Double == 402)
        #expect(screen["height"] as? Double == 874)

        let screenshot = try #require(parsed["screenshot"] as? [String: Any])
        #expect(screenshot["mediaType"] as? String == "image/jpeg")
        #expect(screenshot["dataUrl"] as? String == "data:image/jpeg;base64,SlBFRw==")

        let axTree = try #require(parsed["axTree"] as? [String: Any])
        #expect(axTree["role"] as? String == "AXApplication")

        let tool = try #require(parsed["tool"] as? [String: Any])
        #expect(tool["name"] as? String == "baguette-codex-review-mode")
    }

    @Test func `reviewSnapshotJSONString reports unknownDevice for an unknown udid`() async throws {
        let sims = MockSimulators()
        given(sims).find(udid: .value("ghost")).willReturn(nil)

        await #expect(throws: Server.ReviewSnapshotError.unknownDevice) {
            _ = try await Server.reviewSnapshotJSONString(
                udid: "ghost",
                quality: 0.85,
                scale: 1,
                simulators: sims,
                capture: { _, _, _ in Data() },
                describe: { _ in Self.axTree() }
            )
        }
    }

    @Test func `reviewSnapshotJSONString reports noAccessibilityData when describeAll returns nil`() async throws {
        let sim = Self.simulator()

        await #expect(throws: Server.ReviewSnapshotError.noAccessibilityData) {
            _ = try await Server.reviewSnapshotJSONString(
                udid: "UDID-1",
                quality: 0.85,
                scale: 1,
                simulators: Self.simulators(with: sim),
                capture: { _, _, _ in Data("JPEG".utf8) },
                describe: { _ in nil }
            )
        }
    }

    @Test func `reviewSnapshotJSONString propagates screenshot capture failures`() async throws {
        let sim = Self.simulator()

        await #expect(throws: StubError.boom) {
            _ = try await Server.reviewSnapshotJSONString(
                udid: "UDID-1",
                quality: 0.85,
                scale: 1,
                simulators: Self.simulators(with: sim),
                capture: { _, _, _ in throw StubError.boom },
                describe: { _ in Self.axTree() }
            )
        }
    }

    @Test func `reviewSnapshotJSONString propagates accessibility failures`() async throws {
        let sim = Self.simulator()

        await #expect(throws: StubError.boom) {
            _ = try await Server.reviewSnapshotJSONString(
                udid: "UDID-1",
                quality: 0.85,
                scale: 1,
                simulators: Self.simulators(with: sim),
                capture: { _, _, _ in Data("JPEG".utf8) },
                describe: { _ in throw StubError.boom }
            )
        }
    }

    private enum StubError: Error, Equatable {
        case boom
    }

    private static func simulator() -> any Simulator {
        let sim = MockSimulator()
        given(sim).udid.willReturn("UDID-1")
        given(sim).name.willReturn("iPhone 17 Pro")
        given(sim).runtime.willReturn("iOS 26.2")
        return sim
    }

    private static func simulators(with sim: any Simulator) -> any Simulators {
        let sims = MockSimulators()
        given(sims).find(udid: .value(sim.udid)).willReturn(sim)
        return sims
    }

    private static func axTree() -> AXNode {
        AXNode(
            role: "AXApplication",
            label: "Fixture",
            frame: Rect(
                origin: Point(x: 0, y: 0),
                size: Size(width: 402, height: 874)
            ),
            children: [
                AXNode(
                    role: "AXButton",
                    label: "Continue",
                    identifier: "fixture.continue",
                    frame: Rect(
                        origin: Point(x: 24, y: 700),
                        size: Size(width: 354, height: 52)
                    )
                ),
            ]
        )
    }
}
