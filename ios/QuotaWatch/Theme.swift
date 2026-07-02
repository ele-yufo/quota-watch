import SwiftUI

/// Design system — a dark "instrument panel" aesthetic. Brand fonts (Fraunces
/// display + JetBrains Mono numerals, matching the web app), a deep near-black
/// canvas with a subtle vertical gradient, and elevated card surfaces.
enum Theme {
    // ── Canvas & surfaces ───────────────────────────────────────────────
    static let bgTop = Color(red: 0.06, green: 0.07, blue: 0.10)
    static let bgBottom = Color(red: 0.02, green: 0.03, blue: 0.05)
    static let surface = Color(red: 0.10, green: 0.11, blue: 0.14)
    static let surfaceHi = Color(red: 0.13, green: 0.145, blue: 0.18)
    static let hairline = Color.white.opacity(0.07)

    // ── Text ────────────────────────────────────────────────────────────
    static let ink = Color(white: 0.97)
    static let ink2 = Color(white: 0.62)
    static let ink3 = Color(white: 0.42)

    /// The app-wide background: a deep dial — vertical gradient + a faint
    /// guilloché texture + a vignette that focuses the eye. Not a flat fill.
    static var canvas: some View {
        ZStack {
            LinearGradient(colors: [bgTop, bgBottom], startPoint: .top, endPoint: .bottom)
            GuillocheTexture().opacity(0.35)
            RadialGradient(colors: [.clear, Color.black.opacity(0.22)],
                           center: .init(x: 0.5, y: 0.42), startRadius: 90, endRadius: 520)
        }
        .ignoresSafeArea()
    }

    /// Brushed-metal hairline for card edges — catches "light" top-left.
    static var metalStroke: LinearGradient {
        LinearGradient(colors: [Color.white.opacity(0.18), Color.white.opacity(0.04), Color.white.opacity(0.10)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// A subtle guilloché — concentric hairline rings + fine radial spokes, like an
/// engine-turned watch dial. Very low opacity; pure atmosphere.
struct GuillocheTexture: View {
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width * 0.5, y: size.height * 0.36)
            let maxR = max(size.width, size.height)
            let ink = GraphicsContext.Shading.color(.white.opacity(0.025))
            var r: CGFloat = 26
            while r < maxR {
                let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
                ctx.stroke(Path(ellipseIn: rect), with: ink, lineWidth: 0.6)
                r += 26
            }
            let spokes = 90
            for i in 0..<spokes {
                let a = (Double(i) / Double(spokes)) * 2 * .pi
                var p = Path()
                p.move(to: c)
                p.addLine(to: CGPoint(x: c.x + cos(a) * maxR, y: c.y + sin(a) * maxR))
                ctx.stroke(p, with: .color(.white.opacity(0.012)), lineWidth: 0.5)
            }
        }
    }
}

/// Card background: deep surface + a top sheen + a brushed-metal hairline edge.
struct InstrumentCard<S: Shape>: View {
    let shape: S
    var body: some View {
        shape
            .fill(Theme.surface)
            .overlay(
                shape.fill(
                    LinearGradient(colors: [Color.white.opacity(0.05), .clear],
                                   startPoint: .top, endPoint: .center)
                )
            )
            .overlay(shape.stroke(Theme.metalStroke, lineWidth: 1))
    }
}

// ── Status → colour (tuned for the dark canvas) ─────────────────────────

enum UsageLevel {
    case ok, warn, low

    init(remainingPct: Double) {
        if remainingPct < 10 { self = .low }
        else if remainingPct < 30 { self = .warn }
        else { self = .ok }
    }

    var color: Color {
        switch self {
        case .ok: return Color(red: 0.36, green: 0.76, blue: 0.56)   // refined emerald
        case .warn: return Color(red: 0.93, green: 0.71, blue: 0.35)  // refined amber
        case .low: return Color(red: 0.92, green: 0.44, blue: 0.42)   // refined coral
        }
    }

    var label: String {
        switch self {
        case .ok: return "充足"
        case .warn: return "偏紧"
        case .low: return "告急"
        }
    }
}

// ── Brand typography ────────────────────────────────────────────────────

extension Font {
    /// Fraunces Black — the wordmark / big display headline.
    static func qwDisplay(_ size: CGFloat) -> Font { .custom("Fraunces-Black", size: size) }
    static func qwDisplayItalic(_ size: CGFloat) -> Font { .custom("Fraunces-BlackItalic", size: size) }

    /// JetBrains Mono — every numeric readout + technical label (the instrument voice).
    static func qwNum(_ size: CGFloat, _ weight: QWMono = .bold) -> Font {
        .custom(weight.psName, size: size)
    }
    static func qwLabel(_ size: CGFloat) -> Font { .custom("JetBrainsMono-Medium", size: size) }
}

enum QWMono {
    case regular, medium, bold, extraBold
    var psName: String {
        switch self {
        case .regular: return "JetBrainsMono-Regular"
        case .medium: return "JetBrainsMono-Medium"
        case .bold: return "JetBrainsMono-Bold"
        case .extraBold: return "JetBrainsMono-ExtraBold"
        }
    }
}
