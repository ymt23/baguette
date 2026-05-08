// Single source of truth for the CLI version string. The release
// workflow rewrites this literal in CI before `swift build` (see
// `.github/workflows/release.yml` step "Inject release version") so
// shipped binaries report their actual tag. The value committed here
// is what local debug / Homebrew-from-source builds report.
let baguetteVersion = "0.1.61"

// Fork-local CX Review extension version. Keep this separate from
// the upstream Baguette version so upstream syncs can move the base
// version without implying CX Review API or plugin changes.
let baguetteCXReviewVersion = "0.1.0"
let baguetteReviewAPIVersion = "1"
let baguetteAnnotationPayloadVersion = "1"
