import Foundation
import Testing
@testable import Baguette

@Suite("Server review annotation store")
struct ReviewAnnotationStoreTests {
    @Test func `put stores payload and counts comments and manual rectangles`() async throws {
        let store = ReviewAnnotationStore()
        let record = try await store.put(udid: "UDID-1", data: Data(Self.payload.utf8))

        #expect(record.udid == "UDID-1")
        #expect(record.snapshotId == "snap-1")
        #expect(record.annotationCount == 3)
        #expect(record.manualRectCount == 1)
        #expect(!record.storedAt.isEmpty)
        #expect(!record.updatedAt.isEmpty)

        let object = try #require(ReviewAnnotationStore.responseObject(for: record)["payload"] as? [String: Any])
        let annotations = try #require(object["annotations"] as? [[String: Any]])
        #expect(annotations.count == 2)
    }

    @Test func `put preserves storedAt and updates counts on replacement`() async throws {
        let store = ReviewAnnotationStore()
        let first = try await store.put(udid: "UDID-1", data: Data(Self.payload.utf8))
        let second = try await store.put(udid: "UDID-1", data: Data(Self.emptyPayload.utf8))

        #expect(second.storedAt == first.storedAt)
        #expect(second.annotationCount == 0)
        #expect(second.manualRectCount == 0)
    }

    @Test func `get returns nil after delete`() async throws {
        let store = ReviewAnnotationStore()
        _ = try await store.put(udid: "UDID-1", data: Data(Self.payload.utf8))
        await store.delete(udid: "UDID-1")

        let record = await store.get(udid: "UDID-1")
        #expect(record == nil)
    }

    @Test func `malformed JSON is rejected`() async throws {
        let store = ReviewAnnotationStore()

        await #expect(throws: ReviewAnnotationStoreError.malformedJSON) {
            _ = try await store.put(udid: "UDID-1", data: Data("{".utf8))
        }
    }

    private static let payload = """
    {
      "snapshot": { "snapshotId": "snap-1" },
      "annotations": [
        {
          "target": { "type": "ax-node", "targetId": "home.title|0.0" },
          "comments": [
            { "id": "c1", "note": "title" },
            { "id": "c2", "note": "title2" }
          ]
        },
        {
          "target": { "type": "manual-rect", "targetId": "manual-1", "role": "ManualRectangle" },
          "comments": [
            { "id": "c3", "note": "image" }
          ]
        }
      ],
      "tool": { "name": "baguette-codex-review-mode", "version": "1" }
    }
    """

    private static let emptyPayload = """
    {
      "snapshot": { "snapshotId": "snap-2" },
      "annotations": [],
      "tool": { "name": "baguette-codex-review-mode", "version": "1" }
    }
    """
}
