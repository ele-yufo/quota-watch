import SwiftUI

/// Per-provider visual identity — the real brand logo (bundled from lobe-icons /
/// simple-icons as template SVGs) tinted with the brand's accent colour, keyed
/// by `providerType`. Colours are tuned to read on the dark canvas.
struct ProviderStyle {
    let accent: Color
    /// asset name of the brand glyph in Assets.xcassets (template-rendered)
    let icon: String

    static func of(_ providerType: String) -> ProviderStyle {
        switch providerType {
        case "claude":
            return .init(accent: Color(red: 0.85, green: 0.53, blue: 0.35), icon: "brand-claude")
        case "codex":
            return .init(accent: Color(white: 0.94), icon: "brand-codex")
        case "glm-cn":
            return .init(accent: Color(red: 0.40, green: 0.64, blue: 1.0), icon: "brand-glm")
        case "opencode-go":
            return .init(accent: Color(red: 0.80, green: 0.82, blue: 0.86), icon: "brand-opencode")
        case "kimi":
            return .init(accent: Color(red: 0.36, green: 0.36, blue: 0.40), icon: "brand-kimi")
        case "antigravity":
            return .init(accent: Color(red: 0.42, green: 0.66, blue: 0.98), icon: "brand-antigravity")
        case "copilot":
            return .init(accent: Color(white: 0.90), icon: "brand-copilot")
        case "gemini-cli", "gemini":
            return .init(accent: Color(red: 0.45, green: 0.68, blue: 1.0), icon: "brand-gemini")
        default:
            return .init(accent: Color(red: 0.55, green: 0.68, blue: 0.85), icon: "brand-claude")
        }
    }
}

/// The provider's brand glyph in a tinted rounded tile — one consistent
/// treatment used by the list card and the detail header.
struct ProviderBadge: View {
    let style: ProviderStyle
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(style.accent.opacity(0.16))
            Image(style.icon)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(style.accent)
                .frame(width: size * 0.56, height: size * 0.56)
        }
        .frame(width: size, height: size)
    }
}
