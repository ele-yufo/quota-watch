import SwiftUI

/// Per-provider visual identity — the real brand logo (bundled from lobe-icons /
/// simple-icons as template SVGs) tinted with the brand's accent colour, keyed
/// by `providerType`. Brand colours live in the Asset Catalog as QW.* with
/// light/dark variants, and only ever appear on the icon + status dot — never
/// as quota semantics.
struct ProviderStyle {
    let accent: Color
    /// asset name of the brand glyph in Assets.xcassets (template-rendered)
    let icon: String

    static func of(_ providerType: String) -> ProviderStyle {
        switch providerType {
        case "claude":
            return .init(accent: QWColor.claude, icon: "brand-claude")
        case "codex":
            return .init(accent: QWColor.codex, icon: "brand-codex")
        case "glm-cn":
            return .init(accent: QWColor.glm, icon: "brand-glm")
        case "opencode-go":
            return .init(accent: QWColor.opencode, icon: "brand-opencode")
        case "kimi":
            return .init(accent: QWColor.kimi, icon: "brand-kimi")
        case "antigravity":
            return .init(accent: QWColor.antigravity, icon: "brand-antigravity")
        case "copilot":
            return .init(accent: QWColor.muted, icon: "brand-copilot")
        case "gemini-cli", "gemini":
            return .init(accent: QWColor.glm, icon: "brand-gemini")
        default:
            // 未知 provider —— 通用图标，不冒充任何品牌
            return .init(accent: QWColor.muted, icon: "brand-generic")
        }
    }
}

/// The provider's brand glyph in a tinted rounded tile — one consistent
/// treatment used by the list row and the detail header.
struct ProviderBadge: View {
    let style: ProviderStyle
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(style.accent.opacity(0.14))
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
