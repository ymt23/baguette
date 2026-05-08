import Foundation
import Hummingbird
import HummingbirdWebSocket
import NIOCore
@_spi(WSInternal) import WSCore

/// Standalone HTTP + WebSocket server for `baguette serve`.
///
/// The server is **dumb**: it serves static UI files unchanged and
/// projects domain values to JSON / PNG. No HTML rewriting, no
/// template extraction, no script inlining. Anything UI-shaped lives
/// in `Resources/Web/` and is the front-end's problem.
///
/// Canonical routes (no `/api/` prefix; UDID always in path; format
/// distinguished by file extension):
///
///   GET  /                                  → 302 → /simulators
///   GET  /simulators                        → sim.html
///   GET  /simulators.json                   → list JSON
///   GET  /simulators/:udid                  → sim.html  (stream)
///   POST /simulators/:udid/boot             → simulator.boot()
///   POST /simulators/:udid/shutdown         → simulator.shutdown()
///   GET  /simulators/:udid/chrome.json      → chrome layout JSON
///   GET  /simulators/:udid/bezel.png        → composite PNG
///   POST /simulators/:udid/input            → gesture     (TODO)
///   GET  /simulators/:udid/screenshot.jpg   → JPEG (?quality=&scale=)
///   GET  /simulators/:udid/review-snapshot.json → screenshot + AX tree JSON
///   PUT  /simulators/:udid/review-annotations.json → save CX review annotations
///   GET  /simulators/:udid/review-annotations.json → latest saved annotations
///   DEL  /simulators/:udid/review-annotations.json → clear saved annotations
///   GET  /review/status.json                → review API status
///   WS   /simulators/:udid/stream?format=   → frames      (TODO)
///   GET  /<file>.{html,js,css}              → static UI asset
///
/// Static UI siblings live at the *root* (e.g. `GET /sim-list.js`)
/// so the page at `/simulators` resolves `<script src="sim-list.js">`
/// to a sibling — no prefix juggling, no conflict with the
/// `/simulators/:udid` resource tree (UDIDs don't end in `.js`).
struct Server: Sendable {
    let simulators: any Simulators
    let chromes: any Chromes
    let reviewAnnotations: ReviewAnnotationStore
    let host: String
    let port: Int

    init(
        simulators: any Simulators,
        chromes: any Chromes,
        reviewAnnotations: ReviewAnnotationStore = ReviewAnnotationStore(),
        host: String = "127.0.0.1",
        port: Int = 8421
    ) {
        self.simulators = simulators
        self.chromes = chromes
        self.reviewAnnotations = reviewAnnotations
        self.host = host
        self.port = port
    }

    func run() async throws {
        let router = makeRouter()
        log("listening on http://\(host):\(port)/simulators")

        let app = Application(
            router: router,
            server: .http1WebSocketUpgrade(webSocketRouter: router),
            configuration: .init(address: .hostname(host, port: port))
        )
        try await app.runService()
    }

    /// Exposed for tests — build the router without binding a port.
    func makeRouter() -> Router<BasicWebSocketRequestContext> {
        let router = Router(context: BasicWebSocketRequestContext.self)
        registerRoutes(on: router)
        return router
    }

    // MARK: - routes

    private func registerRoutes(on router: Router<BasicWebSocketRequestContext>) {
        // List page (HTML + sibling assets).
        router.get("/") { _, _ in Self.redirect(to: "/simulators") }
        router.get("/simulators") { _, _ in Self.staticAsset("sim.html") }
        router.get("/simulators.json") { [simulators] _, _ in Self.listJSON(simulators) }
        router.get("/review/status.json") { [simulators, reviewAnnotations] _, _ in
            await Self.reviewStatusJSON(simulators: simulators, store: reviewAnnotations)
        }

        // Stream page — same sim.html, JS routes the inner view based on URL.
        router.get("/simulators/:udid") { _, _ in Self.staticAsset("sim.html") }

        // Simulator actions.
        router.post("/simulators/:udid/boot")     { [simulators] r, _ in
            Self.lifecycle(udid: Self.udidParam(r), simulators: simulators) { try $0.boot() }
        }
        router.post("/simulators/:udid/shutdown") { [simulators] r, _ in
            Self.lifecycle(udid: Self.udidParam(r), simulators: simulators) { try $0.shutdown() }
        }
        // Orientation — `?value=portrait|landscape-left|landscape-right|portrait-upside-down`.
        // Routes through `simulator.orientation().set(...)` which fires
        // a GSEvent over `PurpleWorkspacePort`. Pure parse + dispatch
        // logic lives in `Server.applyOrientation` for unit testing.
        router.post("/simulators/:udid/orientation") { [simulators] r, _ in
            let value = r.uri.queryParameters.get("value") ?? ""
            switch Self.applyOrientation(
                udid: Self.udidParam(r), value: value, simulators: simulators
            ) {
            case .ok:
                return jsonOK
            case .invalidValue:
                return errorJSON(
                    "value must be one of portrait, landscape-left, landscape-right, portrait-upside-down",
                    status: .badRequest
                )
            case .unknownDevice:
                return errorJSON("unknown udid: \(Self.udidParam(r))", status: .notFound)
            case .dispatchFailed:
                return errorJSON(
                    "orientation change failed (PurpleWorkspacePort unreachable?)",
                    status: .internalServerError
                )
            }
        }

        // Chrome / bezel — DeviceKit-sourced layout + rasterized PNG.
        router.get("/simulators/:udid/chrome.json") { [simulators, chromes] r, _ in
            Self.chromeJSON(udid: Self.udidParam(r), simulators: simulators, chromes: chromes)
        }
        router.get("/simulators/:udid/bezel.png") { [simulators, chromes] r, _ in
            // ?buttons=false → bare device body (no buttons baked in).
            // The actionable-bezel front end layers per-button images on
            // top via the /chrome-button/<name>.png route below.
            // Default (true) preserves today's merged composite.
            let withButtons = r.uri.queryParameters.get("buttons")
                .map { $0.lowercased() != "false" } ?? true
            return Self.bezelPNG(
                udid: Self.udidParam(r),
                simulators: simulators,
                chromes: chromes,
                withButtons: withButtons
            )
        }
        // Per-button rasterized PNG — feeds the actionable-bezel UI.
        // `:file` is the last URL segment, typically `<name>.png`
        // matching a `ChromeButton.name` in `chrome.json` (e.g.
        // `powerButton.png`, `actionButton.png`, `volumeUp.png`).
        // Registered before the catch-all `/:file` so the longer
        // template wins.
        //
        // UDID extraction here uses positional indexing on the path
        // (`parts[1]`) instead of `udidParam` — that helper assumes
        // a 3-segment path and grabs the second-to-last component,
        // which breaks for this 4-segment template.
        router.get("/simulators/:udid/chrome-button/:file") { [simulators, chromes] r, _ in
            let parts = r.uri.path.split(separator: "/")
            let udid = parts.count >= 4
                ? String(parts[1]).removingPercentEncoding ?? ""
                : ""
            let last = String(parts.last ?? "")
                .removingPercentEncoding ?? ""
            return Self.chromeButtonPNG(
                udid: udid,
                buttonFile: last,
                simulators: simulators,
                chromes: chromes
            )
        }

        // One-shot JPEG of the current framebuffer. Spins up Screen,
        // awaits one IOSurface, encodes, and tears down — `?quality=`
        // and `?scale=` mirror the WS stream knobs for parity.
        router.get("/simulators/:udid/screenshot.jpg") { [simulators] r, _ in
            await Self.screenshotJPEG(
                udid: Self.udidParam(r),
                quality: r.uri.queryParameters.get("quality").flatMap(Double.init) ?? 0.85,
                scale: r.uri.queryParameters.get("scale").flatMap(Int.init) ?? 1,
                simulators: simulators
            )
        }
        router.get("/simulators/:udid/review-snapshot.json") { [simulators] r, _ in
            await Self.reviewSnapshotJSON(
                udid: Self.udidParam(r),
                quality: r.uri.queryParameters.get("quality").flatMap(Double.init) ?? 0.85,
                scale: r.uri.queryParameters.get("scale").flatMap(Int.init) ?? 1,
                simulators: simulators
            )
        }
        router.put("/simulators/:udid/review-annotations.json") { [simulators, reviewAnnotations] r, _ in
            await Self.putReviewAnnotations(
                udid: Self.udidParam(r),
                request: r,
                simulators: simulators,
                store: reviewAnnotations
            )
        }
        router.get("/simulators/:udid/review-annotations.json") { [simulators, reviewAnnotations] r, _ in
            await Self.getReviewAnnotations(
                udid: Self.udidParam(r),
                simulators: simulators,
                store: reviewAnnotations
            )
        }
        router.delete("/simulators/:udid/review-annotations.json") { [simulators, reviewAnnotations] r, _ in
            await Self.deleteReviewAnnotations(
                udid: Self.udidParam(r),
                simulators: simulators,
                store: reviewAnnotations
            )
        }

        // Device-farm UI — multi-device dashboard. The HTML at /farm
        // is a thin shell that loads its own component scripts from
        // the `farm/` subfolder; sibling assets (CSS + per-component
        // JS) resolve against `/farm/<file>`. Registered before the
        // catch-all `/:file` so `/farm` doesn't get hijacked.
        router.get("/farm") { _, _ in Self.staticAsset("farm/farm.html") }
        router.get("/farm/:file") { r, _ in
            let name = String(r.uri.path.split(separator: "/").last ?? "")
                .removingPercentEncoding ?? ""
            return Self.staticAsset("farm/\(name)")
        }

        // Live stream — encoded frames downstream as binary; upstream
        // text JSON carries everything else: gesture input + runtime
        // control (set_bitrate / set_fps / set_scale / force_idr /
        // snapshot). One bidirectional channel per session means no
        // POST /event side-route, no UDID-keyed registry — the WS
        // closure already owns the live stream + sim handles.
        router.ws("/simulators/:udid/stream") { [simulators] inbound, outbound, context in
            await Self.streamWS(
                udid: Self.udidParam(context.request),
                format: context.request.uri.queryParameters.get("format")
                    .flatMap { StreamFormat(rawValue: $0) } ?? .mjpeg,
                simulators: simulators,
                inbound: inbound,
                outbound: outbound
            )
        }

        // Live unified-log feed — dedicated socket so logs don't
        // share lifetime / backpressure with the frame stream.
        // Filter is fixed at connect time (query string); restart
        // the socket to change the filter. Closing the socket from
        // the client tears down the spawned `log` child.
        registerLogsRoute(on: router)

        // Static UI siblings — JS / HTML / CSS files in Resources/Web/
        // accessed by name. Path component is the bare filename.
        router.get("/:file") { r, _ in
            let name = String(r.uri.path.split(separator: "/").last ?? "")
                .removingPercentEncoding ?? ""
            return Self.staticAsset(name)
        }
    }

    // MARK: - handlers

    private static func staticAsset(_ name: String) -> Response {
        guard let data = WebRoot.data(named: name) else {
            return Response(
                status: .notFound,
                headers: [.contentType: "text/plain; charset=utf-8"],
                body: .init(byteBuffer: ByteBuffer(string:
                    "missing \(name) — set BAGUETTE_WEB_DIR or rebuild"
                ))
            )
        }
        return Response(
            status: .ok,
            headers: [.contentType: contentType(for: name), .cacheControl: "no-cache"],
            body: .init(byteBuffer: ByteBuffer(data: data))
        )
    }

    private static func listJSON(_ simulators: any Simulators) -> Response {
        Response(
            status: .ok,
            headers: [.contentType: "application/json", .cacheControl: "no-cache"],
            body: .init(byteBuffer: ByteBuffer(string: simulators.listJSON))
        )
    }

    /// Outcome of `applyOrientation` — one case per HTTP-status
    /// branch the orientation route maps to. Lives next to the
    /// helper so the route closure in `addRoutes(...)` is just a
    /// `switch outcome → Response` translation.
    enum OrientationOutcome: Equatable {
        case ok
        case invalidValue
        case unknownDevice
        case dispatchFailed
    }

    /// Pure parse + dispatch: validate `value`, look up the
    /// simulator, and run `simulator.orientation().set(...)`. Split
    /// out from the route closure so unit tests can drive every
    /// branch (`MockSimulators` + `MockOrientation`) without booting
    /// Hummingbird.
    static func applyOrientation(
        udid: String,
        value: String,
        simulators: any Simulators
    ) -> OrientationOutcome {
        guard let orientation = DeviceOrientation(wireName: value) else {
            return .invalidValue
        }
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            return .unknownDevice
        }
        return sim.orientation().set(orientation) ? .ok : .dispatchFailed
    }

    private static func lifecycle(
        udid: String,
        simulators: any Simulators,
        action: (Simulator) throws -> Void
    ) -> Response {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        }
        do {
            try action(sim)
            return jsonOK
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    private static func chromeJSON(
        udid: String,
        simulators: any Simulators,
        chromes: any Chromes
    ) -> Response {
        guard let json = chromeJSONString(
            udid: udid, simulators: simulators, chromes: chromes
        ) else {
            return errorJSON("no chrome for udid \(udid)", status: .notFound)
        }
        return Response(
            status: .ok,
            headers: [.contentType: "application/json", .cacheControl: "no-cache"],
            body: .init(byteBuffer: ByteBuffer(string: json))
        )
    }

    /// Pure data producer for `chrome.json`. Internal so handler-level
    /// tests can drive it with mock `Simulators` + `Chromes` and assert
    /// on the JSON string directly. The route closure (`chromeJSON`)
    /// is the thin wrapper that builds the `Response`.
    ///
    /// Includes `imageUrl` per button — the actionable-bezel front end
    /// fetches each rasterized button from the
    /// `/simulators/<udid>/chrome-button/<name>.png` route below.
    static func chromeJSONString(
        udid: String,
        simulators: any Simulators,
        chromes: any Chromes
    ) -> String? {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid),
              let assets = sim.chrome(in: chromes) else {
            return nil
        }
        return assets.layoutJSON(
            buttonImageURLPrefix: "/simulators/\(udid)/chrome-button/"
        )
    }

    private static func screenshotJPEG(
        udid: String,
        quality: Double,
        scale: Int,
        simulators: any Simulators
    ) async -> Response {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        }
        do {
            let bytes = try await ScreenSnapshot.capture(
                screen: sim.screen(),
                quality: quality,
                scale: max(1, scale)
            )
            return Response(
                status: .ok,
                headers: [.contentType: "image/jpeg", .cacheControl: "no-cache"],
                body: .init(byteBuffer: ByteBuffer(data: bytes))
            )
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    private static func reviewSnapshotJSON(
        udid: String,
        quality: Double,
        scale: Int,
        simulators: any Simulators
    ) async -> Response {
        do {
            let json = try await reviewSnapshotJSONString(
                udid: udid,
                quality: quality,
                scale: scale,
                simulators: simulators
            ) { sim, quality, scale in
                try await ScreenSnapshot.capture(
                    screen: sim.screen(),
                    quality: quality,
                    scale: max(1, scale)
                )
            } describe: { sim in
                try sim.accessibility().describeAll()
            }
            return Response(
                status: .ok,
                headers: [.contentType: "application/json", .cacheControl: "no-cache"],
                body: .init(byteBuffer: ByteBuffer(string: json))
            )
        } catch ReviewSnapshotError.unknownDevice {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        } catch ReviewSnapshotError.noAccessibilityData {
            return errorJSON("no accessibility data", status: .internalServerError)
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    enum ReviewSnapshotError: Error, Equatable {
        case unknownDevice
        case noAccessibilityData
    }

    static func reviewSnapshotJSONString(
        udid: String,
        quality: Double,
        scale: Int,
        simulators: any Simulators,
        capture: (any Simulator, Double, Int) async throws -> Data,
        describe: (any Simulator) throws -> AXNode?
    ) async throws -> String {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            throw ReviewSnapshotError.unknownDevice
        }
        let snapshotId = iso8601SnapshotId()
        let tree = try describe(sim)
        guard let tree else { throw ReviewSnapshotError.noAccessibilityData }
        let screenshot = try await capture(sim, quality, max(1, scale))
        let axTree = try jsonObject(from: tree.json)
        let payload: [String: Any] = [
            "snapshotId": snapshotId,
            "createdAt": snapshotId,
            "device": [
                "name": sim.name,
                "runtime": sim.runtime,
                "udid": sim.udid,
            ],
            "screen": [
                "width": tree.frame.size.width,
                "height": tree.frame.size.height,
            ],
            "screenshot": [
                "mediaType": "image/jpeg",
                "dataUrl": "data:image/jpeg;base64,\(screenshot.base64EncodedString())",
            ],
            "axTree": axTree,
            "tool": [
                "name": "baguette-codex-review-mode",
                "version": "1",
            ],
        ]
        let data = try JSONSerialization.data(
            withJSONObject: payload,
            options: [.sortedKeys]
        )
        return String(decoding: data, as: UTF8.self)
    }

    private static func putReviewAnnotations(
        udid: String,
        request: Request,
        simulators: any Simulators,
        store: ReviewAnnotationStore
    ) async -> Response {
        guard !udid.isEmpty, simulators.find(udid: udid) != nil else {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        }
        do {
            var request = request
            let body = try await request.collectBody(upTo: 2_000_000)
            let record = try await store.put(udid: udid, data: Data(buffer: body))
            return try jsonResponse(ReviewAnnotationStore.responseObject(for: record))
        } catch ReviewAnnotationStoreError.malformedJSON {
            return errorJSON("malformed review annotation JSON", status: .badRequest)
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    private static func getReviewAnnotations(
        udid: String,
        simulators: any Simulators,
        store: ReviewAnnotationStore
    ) async -> Response {
        guard !udid.isEmpty, simulators.find(udid: udid) != nil else {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        }
        guard let record = await store.get(udid: udid) else {
            return errorJSON("no review annotations for udid: \(udid)", status: .notFound)
        }
        do {
            return try jsonResponse(ReviewAnnotationStore.responseObject(for: record))
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    private static func deleteReviewAnnotations(
        udid: String,
        simulators: any Simulators,
        store: ReviewAnnotationStore
    ) async -> Response {
        guard !udid.isEmpty, simulators.find(udid: udid) != nil else {
            return errorJSON("unknown udid: \(udid)", status: .notFound)
        }
        await store.delete(udid: udid)
        return jsonOK
    }

    private static func reviewStatusJSON(
        simulators: any Simulators,
        store: ReviewAnnotationStore
    ) async -> Response {
        let records = await store.all()
        let reviews = records.map(ReviewAnnotationStore.summaryObject(for:))
        let devices = simulators.all.map { sim in
            [
                "udid": sim.udid,
                "name": sim.name,
                "runtime": sim.runtime,
                "state": sim.state.description,
            ]
        }
        let object: [String: Any] = [
            "ok": true,
            "baguette": [
                "version": baguetteVersion,
            ],
            "cxReview": [
                "version": baguetteCXReviewVersion,
                "reviewApiVersion": ReviewAnnotationStore.reviewApiVersion,
                "annotationPayloadVersion": ReviewAnnotationStore.annotationPayloadVersion,
            ],
            "plugin": [
                "version": ReviewAnnotationStore.pluginVersion,
                "mcpVersion": ReviewAnnotationStore.mcpVersion,
                "templateVersion": ReviewAnnotationStore.templateVersion,
            ],
            "compatible": true,
            "reviewCount": reviews.count,
            "latestUpdatedAt": records.map(\.updatedAt).max() ?? NSNull(),
            "reviews": reviews,
            "simulators": devices,
        ]
        do {
            return try jsonResponse(object)
        } catch {
            return errorJSON(String(describing: error), status: .internalServerError)
        }
    }

    private static func bezelPNG(
        udid: String,
        simulators: any Simulators,
        chromes: any Chromes,
        withButtons: Bool = true
    ) -> Response {
        guard let bytes = bezelImage(
            udid: udid, simulators: simulators,
            chromes: chromes, withButtons: withButtons
        ) else {
            return Response(
                status: .notFound,
                headers: [.contentType: "text/plain"],
                body: .init(byteBuffer: ByteBuffer(string: "no bezel for \(udid)"))
            )
        }
        return Response(
            status: .ok,
            headers: [.contentType: "image/png", .cacheControl: "public, max-age=86400"],
            body: .init(byteBuffer: ByteBuffer(data: bytes))
        )
    }

    /// Pure data producer for the bezel image. Returns `nil` for
    /// unknown UDIDs / chromes so the route closure can collapse to
    /// 404 uniformly.
    ///
    /// `withButtons: false` returns the bare device body (`?buttons=
    /// false` on the route) — the actionable-bezel front end layers
    /// per-button images on top, animating each independently.
    /// `withButtons: true` (the default) returns the merged composite
    /// — today's behaviour.
    static func bezelImage(
        udid: String,
        simulators: any Simulators,
        chromes: any Chromes,
        withButtons: Bool
    ) -> Data? {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid),
              let assets = sim.chrome(in: chromes) else {
            return nil
        }
        return withButtons ? assets.composite.data : assets.bareComposite.data
    }

    private static func chromeButtonPNG(
        udid: String,
        buttonFile: String,
        simulators: any Simulators,
        chromes: any Chromes
    ) -> Response {
        guard let bytes = chromeButtonImage(
            udid: udid, buttonFile: buttonFile,
            simulators: simulators, chromes: chromes
        ) else {
            return Response(
                status: .notFound,
                headers: [.contentType: "text/plain"],
                body: .init(byteBuffer: ByteBuffer(
                    string: "no button \(buttonFile) for \(udid)"
                ))
            )
        }
        return Response(
            status: .ok,
            headers: [.contentType: "image/png", .cacheControl: "public, max-age=86400"],
            body: .init(byteBuffer: ByteBuffer(data: bytes))
        )
    }

    /// Pure data producer for the per-button image route. `buttonFile`
    /// is the last URL path segment (e.g. `"powerButton.png"`). The
    /// `.png` extension is stripped — the front end may or may not
    /// include it, both spellings resolve the same button. Returns
    /// `nil` when the udid / chrome / button name is unknown so the
    /// route 404s uniformly.
    static func chromeButtonImage(
        udid: String,
        buttonFile: String,
        simulators: any Simulators,
        chromes: any Chromes
    ) -> Data? {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid),
              let assets = sim.chrome(in: chromes) else {
            return nil
        }
        let name: String = {
            if buttonFile.hasSuffix(".png") {
                return String(buttonFile.dropLast(4))
            }
            return buttonFile
        }()
        return assets.buttonImages[name]?.data
    }

    /// One WebSocket = one streaming session. Opens Screen + Stream
    /// + WS sink, runs until the client disconnects. Every inbound
    /// text frame is one JSON line dispatched in this order:
    ///   1. ReconfigParser   — set_bitrate / set_fps / set_scale
    ///   2. stream verbs     — force_idr / snapshot
    ///   3. GestureDispatcher — tap / swipe / touch1-* / touch2-* /
    ///      button / scroll / pinch / pan / key / type
    /// Lines not matched by any of the above are ignored — same
    /// graceful behaviour the stdin control channel has.
    private static func streamWS(
        udid: String,
        format: StreamFormat,
        simulators: any Simulators,
        inbound: WebSocketInboundStream,
        outbound: WebSocketOutboundWriter
    ) async {
        guard !udid.isEmpty, let sim = simulators.find(udid: udid) else {
            try? await outbound.write(.text(#"{"ok":false,"error":"unknown udid"}"#))
            return
        }

        let sink = WebSocketFrameSink(outbound: outbound, format: format)
        let stream = format.makeStream(config: .default, sink: sink, quality: 0.5)
        let screen = sim.screen()
        let dispatcher = GestureDispatcher(input: sim.input())

        do {
            try stream.start(on: screen)
        } catch {
            try? await outbound.write(.text(
                #"{"ok":false,"error":"\#(String(describing: error))"}"#
            ))
            return
        }
        defer {
            stream.stop()
            screen.stop()
        }

        do {
            for try await frame in inbound {
                guard frame.opcode == .text else { continue }
                let line = String(buffer: frame.data)
                if await handleDescribeUI(
                    line: line, sim: sim, outbound: outbound
                ) {
                    continue
                }
                handleInbound(
                    line: line,
                    stream: stream,
                    dispatcher: dispatcher
                )
            }
        } catch {
            // socket closed; defer cleans up
        }
    }

    /// `describe_ui` text message — needs the `Simulator` (to reach
    /// the AX port) and the outbound writer (to ship the result
    /// back), neither of which `handleInbound` carries. Returns
    /// `true` when the line was a `describe_ui` envelope (handled
    /// or rejected with an error JSON), `false` for any other
    /// shape so the caller falls through to the gesture / reconfig
    /// pipeline.
    private static func handleDescribeUI(
        line: String,
        sim: Simulator,
        outbound: WebSocketOutboundWriter
    ) async -> Bool {
        guard let data = line.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (dict["type"] as? String) == "describe_ui" else {
            return false
        }
        let ax = sim.accessibility()
        let result: AXNode?
        do {
            if let xv = (dict["x"] as? Double) ?? (dict["x"] as? Int).map(Double.init),
               let yv = (dict["y"] as? Double) ?? (dict["y"] as? Int).map(Double.init) {
                result = try ax.describeAt(point: Point(x: xv, y: yv))
            } else {
                result = try ax.describeAll()
            }
        } catch {
            try? await outbound.write(.text(
                #"{"type":"describe_ui_result","ok":false,"error":"\#(String(describing: error))"}"#
            ))
            return true
        }
        if let tree = result {
            try? await outbound.write(.text(
                #"{"type":"describe_ui_result","ok":true,"tree":\#(tree.json)}"#
            ))
        } else {
            try? await outbound.write(.text(
                #"{"type":"describe_ui_result","ok":false,"error":"no accessibility data"}"#
            ))
        }
        return true
    }

    /// Register the `/simulators/:udid/logs` WebSocket route. Lives
    /// in its own helper because Hummingbird's router-builder
    /// inference grinds to a halt when too many `router.ws` /
    /// `router.get` closures share a single function body.
    private func registerLogsRoute(on router: Router<BasicWebSocketRequestContext>) {
        let simulators = self.simulators
        router.ws("/simulators/:udid/logs") { inbound, outbound, context in
            let req = context.request
            let opts = LogsRouteOptions.from(request: req)
            await Self.logsWS(
                opts: opts,
                simulators: simulators,
                inbound: inbound,
                outbound: outbound
            )
        }
    }

    /// Live log-stream over the dedicated `/simulators/:udid/logs`
    /// WebSocket. Filter is fixed at connect time via query string
    /// (`level`, `style`, `predicate`, `bundleId`). The spawned
    /// `/usr/bin/log stream` child runs for the lifetime of the
    /// socket; closing the socket from either end tears it down.
    ///
    /// Wire envelopes (server → client text frames):
    ///   {"type":"log_started"}
    ///   {"type":"log","lines":["<line>", "<line>", …]}
    ///   {"type":"log_stopped","reason":"<text>"}
    ///
    /// Lines are coalesced through `LogBatcher` (size cap + 50 ms
    /// window): per-line WS frames pegged the browser's main thread
    /// at CoreDuet-chatter rates because the per-frame parse +
    /// dispatch + render cost dwarfs the bytes themselves. One
    /// frame per ~50 ms drops that to ~20 frames/sec and decouples
    /// log volume from UI responsiveness.
    ///
    /// Client → server: a single `{"type":"stop"}` text frame
    /// terminates early. Otherwise the server waits for the child
    /// to exit or the socket to close.
    private static func logsWS(
        opts: LogsRouteOptions,
        simulators: any Simulators,
        inbound: WebSocketInboundStream,
        outbound: WebSocketOutboundWriter
    ) async {
        guard !opts.udid.isEmpty, let sim = simulators.find(udid: opts.udid) else {
            try? await outbound.write(.text(#"{"type":"log_stopped","reason":"unknown udid"}"#))
            return
        }
        guard let lvl = LogFilter.Level(wire: opts.level) else {
            try? await outbound.write(.text(
                #"{"type":"log_stopped","reason":"invalid level: \#(opts.level)"}"#
            ))
            return
        }
        guard let sty = LogFilter.Style(wire: opts.style) else {
            try? await outbound.write(.text(
                #"{"type":"log_stopped","reason":"invalid style: \#(opts.style)"}"#
            ))
            return
        }
        let filter = LogFilter(
            level: lvl, style: sty,
            predicate: opts.predicate, bundleId: opts.bundleId
        )

        let stream = sim.logs()
        let lineQueue = AsyncStream<String>.makeStream(bufferingPolicy: .bufferingNewest(2048))

        do {
            try stream.start(
                filter: filter,
                onLine: { line in
                    lineQueue.continuation.yield(line)
                },
                onTerminate: { _ in
                    lineQueue.continuation.finish()
                }
            )
        } catch {
            try? await outbound.write(.text(
                #"{"type":"log_stopped","reason":"\#(jsonEscape(String(describing: error)))"}"#
            ))
            return
        }

        try? await outbound.write(.text(#"{"type":"log_started"}"#))
        defer { stream.stop() }

        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                // Multiplex lines and a 50ms ticker into one stream so a
                // single consumer can own the batcher without locking.
                enum Event { case line(String); case tick; case end }
                let events = AsyncStream<Event>(bufferingPolicy: .bufferingNewest(4096)) { cont in
                    let lineTask = Task {
                        for await line in lineQueue.stream {
                            cont.yield(.line(line))
                        }
                        cont.yield(.end)
                        cont.finish()
                    }
                    let tickTask = Task {
                        while !Task.isCancelled {
                            try? await Task.sleep(nanoseconds: 50_000_000)
                            if Task.isCancelled { break }
                            cont.yield(.tick)
                        }
                    }
                    cont.onTermination = { _ in
                        lineTask.cancel()
                        tickTask.cancel()
                    }
                }

                var batcher = LogBatcher(maxLines: 200, windowMs: 50)
                consumer: for await event in events {
                    let batch: [String]?
                    switch event {
                    case .line(let line): batch = batcher.ingest(line, now: Date())
                    case .tick:           batch = batcher.tick(now: Date())
                    case .end:
                        if let final = batcher.flush() {
                            _ = try? await outbound.write(.text(envelope(forBatch: final)))
                        }
                        break consumer
                    }
                    if let batch {
                        if (try? await outbound.write(.text(envelope(forBatch: batch)))) == nil {
                            break consumer
                        }
                    }
                }
            }
            group.addTask {
                do {
                    for try await frame in inbound {
                        guard frame.opcode == .text else { continue }
                        let line = String(buffer: frame.data)
                        if let data = line.data(using: .utf8),
                           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           (dict["type"] as? String) == "stop" {
                            break
                        }
                    }
                } catch {
                    // socket closed; defer cleans up
                }
            }
            await group.next()
            group.cancelAll()
        }
        try? await outbound.write(.text(#"{"type":"log_stopped","reason":"client closed"}"#))
    }

    /// Triage one upstream text line: stream config first (cheapest
    /// to detect), then format-level verbs, then gesture dispatch as
    /// the catch-all. ReconfigParser returns the same config when
    /// the line wasn't a `set_*` — that's our discriminator.
    private static func handleInbound(
        line: String,
        stream: any Stream,
        dispatcher: GestureDispatcher
    ) {
        let next = ReconfigParser.apply(line, to: stream.config)
        if next != stream.config {
            stream.apply(next)
            return
        }
        if let data = line.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let kind = dict["type"] as? String {
            switch kind {
            case "force_idr": stream.requestKeyframe(); return
            case "snapshot":  stream.requestSnapshot(); return
            default: break
            }
        }
        _ = dispatcher.dispatch(line: line)
    }

    /// Pull the UDID out of a `/simulators/<udid>/<verb>` request.
    /// `<verb>` is the last segment, `<udid>` the one before.
    private static func udidParam(_ request: Request) -> String {
        let parts = request.uri.path.split(separator: "/")
        guard parts.count >= 3 else { return "" }
        return String(parts[parts.count - 2]).removingPercentEncoding ?? ""
    }


    private static func redirect(to path: String) -> Response {
        Response(
            status: .found,
            headers: [.location: path],
            body: .init(byteBuffer: ByteBuffer(string: ""))
        )
    }
}

// MARK: - review annotation store

struct ReviewAnnotationRecord: Sendable, Equatable {
    let udid: String
    let payloadJSONString: String
    let storedAt: String
    let updatedAt: String
    let annotationCount: Int
    let manualRectCount: Int
    let snapshotId: String?
}

enum ReviewAnnotationStoreError: Error, Equatable {
    case malformedJSON
}

actor ReviewAnnotationStore {
    static let reviewApiVersion = baguetteReviewAPIVersion
    static let annotationPayloadVersion = baguetteAnnotationPayloadVersion
    static let pluginVersion = baguetteCXReviewVersion
    static let mcpVersion = baguetteCXReviewVersion
    static let templateVersion = baguetteCXReviewVersion

    private var records: [String: ReviewAnnotationRecord] = [:]

    func put(udid: String, data: Data) throws -> ReviewAnnotationRecord {
        let parsed = try Self.parsePayload(data)
        let now = iso8601SnapshotId()
        let record = ReviewAnnotationRecord(
            udid: udid,
            payloadJSONString: parsed.payloadJSONString,
            storedAt: records[udid]?.storedAt ?? now,
            updatedAt: now,
            annotationCount: parsed.annotationCount,
            manualRectCount: parsed.manualRectCount,
            snapshotId: parsed.snapshotId
        )
        records[udid] = record
        return record
    }

    func get(udid: String) -> ReviewAnnotationRecord? {
        records[udid]
    }

    func delete(udid: String) {
        records.removeValue(forKey: udid)
    }

    func all() -> [ReviewAnnotationRecord] {
        records.values.sorted { $0.updatedAt > $1.updatedAt }
    }

    static func responseObject(for record: ReviewAnnotationRecord) throws -> [String: Any] {
        [
            "ok": true,
            "reviewApiVersion": reviewApiVersion,
            "annotationPayloadVersion": annotationPayloadVersion,
            "storedAt": record.storedAt,
            "updatedAt": record.updatedAt,
            "annotationCount": record.annotationCount,
            "manualRectCount": record.manualRectCount,
            "payload": try payloadObject(from: record.payloadJSONString),
        ]
    }

    static func summaryObject(for record: ReviewAnnotationRecord) -> [String: Any] {
        [
            "udid": record.udid,
            "snapshotId": record.snapshotId ?? NSNull(),
            "storedAt": record.storedAt,
            "updatedAt": record.updatedAt,
            "annotationCount": record.annotationCount,
            "manualRectCount": record.manualRectCount,
        ]
    }

    private static func parsePayload(_ data: Data) throws -> (
        payloadJSONString: String,
        annotationCount: Int,
        manualRectCount: Int,
        snapshotId: String?
    ) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            JSONSerialization.isValidJSONObject(object)
        else {
            throw ReviewAnnotationStoreError.malformedJSON
        }
        let annotations = object["annotations"] as? [[String: Any]] ?? []
        var annotationCount = 0
        var manualRectCount = 0
        for annotation in annotations {
            let comments = annotation["comments"] as? [[String: Any]] ?? []
            annotationCount += comments.count
            let target = annotation["target"] as? [String: Any]
            if target?["type"] as? String == "manual-rect" ||
                target?["role"] as? String == "ManualRectangle" {
                manualRectCount += 1
            }
        }
        let snapshot = object["snapshot"] as? [String: Any]
        let payloadData = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return (
            String(decoding: payloadData, as: UTF8.self),
            annotationCount,
            manualRectCount,
            snapshot?["snapshotId"] as? String
        )
    }

    private static func payloadObject(from json: String) throws -> Any {
        guard let data = json.data(using: .utf8) else { return NSNull() }
        return try JSONSerialization.jsonObject(with: data)
    }
}

// MARK: - tiny response helpers

private let jsonOK = Response(
    status: .ok,
    headers: [.contentType: "application/json"],
    body: .init(byteBuffer: ByteBuffer(string: "{\"ok\":true}"))
)

private func jsonResponse(_ object: [String: Any], status: HTTPResponse.Status = .ok) throws -> Response {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return Response(
        status: status,
        headers: [.contentType: "application/json", .cacheControl: "no-cache"],
        body: .init(byteBuffer: ByteBuffer(data: data))
    )
}

private func errorJSON(_ message: String, status: HTTPResponse.Status) -> Response {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    return Response(
        status: status,
        headers: [.contentType: "application/json"],
        body: .init(byteBuffer: ByteBuffer(string:
            "{\"ok\":false,\"error\":\"\(escaped)\"}"
        ))
    )
}

/// Plain-old-data carrier for the `/simulators/:udid/logs` query
/// string + path UDID. Pulled into its own struct so the route
/// closure stays a one-liner — Hummingbird's router-builder
/// inference deteriorates fast when the closure body argues with
/// 8-parameter calls inline.
private struct LogsRouteOptions: Sendable {
    let udid: String
    let level: String
    let style: String
    let predicate: String?
    let bundleId: String?

    static func from(request: Request) -> LogsRouteOptions {
        let parts = request.uri.path.split(separator: "/")
        var udid = ""
        if parts.count >= 3 {
            udid = String(parts[parts.count - 2]).removingPercentEncoding ?? ""
        }
        let q = request.uri.queryParameters
        let level: String     = q.get("level").map { String($0) }     ?? "info"
        let style: String     = q.get("style").map { String($0) }     ?? "default"
        let predicate: String? = q.get("predicate").map { String($0) }
        let bundleId: String?  = q.get("bundleId").map { String($0) }
        return LogsRouteOptions(
            udid: udid,
            level: level,
            style: style,
            predicate: predicate,
            bundleId: bundleId
        )
    }
}

/// Minimal JSON-string escaper: backslash, quote, and the ASCII
/// control characters that JSON forbids unescaped. Sufficient for
/// embedding a log line into a `{"line":"…"}` envelope without
/// rebuilding the whole dict via JSONSerialization.
private func jsonEscape(_ s: String) -> String {
    var out = ""
    out.reserveCapacity(s.count + 8)
    for ch in s.unicodeScalars {
        switch ch {
        case "\"":  out.append("\\\"")
        case "\\":  out.append("\\\\")
        case "\n":  out.append("\\n")
        case "\r":  out.append("\\r")
        case "\t":  out.append("\\t")
        case "\u{08}": out.append("\\b")
        case "\u{0C}": out.append("\\f")
        default:
            if ch.value < 0x20 {
                out.append(String(format: "\\u%04x", ch.value))
            } else {
                out.append(Character(ch))
            }
        }
    }
    return out
}

/// Build the `{"type":"log","lines":[…]}` envelope for one drained
/// `LogBatcher` batch. Hand-rolled rather than going through
/// `JSONSerialization` because the hot path runs at most ~20×/sec
/// per logs WS and each entry is already a UTF-8 string we can
/// escape in place.
private func envelope(forBatch lines: [String]) -> String {
    var s = #"{"type":"log","lines":["#
    for (i, line) in lines.enumerated() {
        if i > 0 { s.append(",") }
        s.append("\"")
        s.append(jsonEscape(line))
        s.append("\"")
    }
    s.append("]}")
    return s
}

private func iso8601SnapshotId() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date())
}

private func jsonObject(from json: String) throws -> Any {
    guard let data = json.data(using: .utf8) else {
        return NSNull()
    }
    return try JSONSerialization.jsonObject(with: data)
}

private func contentType(for filename: String) -> String {
    if filename.hasSuffix(".html") { return "text/html; charset=utf-8" }
    if filename.hasSuffix(".js")   { return "application/javascript; charset=utf-8" }
    if filename.hasSuffix(".css")  { return "text/css; charset=utf-8" }
    if filename.hasSuffix(".json") { return "application/json; charset=utf-8" }
    if filename.hasSuffix(".png")  { return "image/png" }
    if filename.hasSuffix(".jpg") || filename.hasSuffix(".jpeg") { return "image/jpeg" }
    return "application/octet-stream"
}
