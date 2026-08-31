import SwiftUI

// ─────────────────────────────────────────────────────────────
// quota-watch · iOS 设计系统 v2（Anthropic 风）
//
// 真源：Open Design 设计文档（quota-watch v2 · Anthropic 风）。
// 色彩为 OKLCH token，构建期转 sRGB 后以 Asset Catalog
// （QW*.colorset）维护亮 / 暗双值；代码只引用语义角色。
// 排版三角色：Fraunces（品牌与关键百分比）/ SF Pro（界面）/
// JetBrains Mono（数值与连接标识）。
// ─────────────────────────────────────────────────────────────

// MARK: - 语义颜色（唯一真源：Assets.xcassets/QWColors）

enum QWColor {
    // 画布与表面
    static let background = Color("QW.Background")   // 亮: 未漂白纸 · 暗: 暖炭
    static let surface    = Color("QW.Surface")
    static let surface2   = Color("QW.Surface2")

    // 文字
    static let foreground = Color("QW.Foreground")
    static let muted      = Color("QW.Muted")
    static let subtle     = Color("QW.Subtle")

    // 结构
    static let border     = Color("QW.Border")

    // 焦点与语义
    static let accent     = Color("QW.Accent")       // 低饱和琥珀
    static let accentInk  = Color("QW.AccentInk")
    static let success    = Color("QW.Success")
    static let warning    = Color("QW.Warning")
    static let warningInk = Color("QW.WarningInk")
    static let danger     = Color("QW.Danger")

    // Provider 品牌色 —— 只用于图标与状态点，不承担配额语义
    static let claude      = Color("QW.Claude")
    static let codex       = Color("QW.Codex")
    static let glm         = Color("QW.GLM")
    static let kimi        = Color("QW.Kimi")
    static let opencode    = Color("QW.OpenCode")
    static let antigravity = Color("QW.Antigravity")
}

// MARK: - 空间 / 圆角 / 动效

enum QWTokens {
    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }
    enum Radius {
        static let control: CGFloat = 10   // 触控控件
        static let sheet: CGFloat = 16     // 系统容器
        static let widget: CGFloat = 24    // 小组件
    }
    enum Motion {
        /// 数字滚动：420ms 轻弹性，仅变化位参与
        static let number = Animation.snappy(duration: 0.42, extraBounce: 0.08)
        /// 列表更新 / 层级出现：220ms 淡入
        static let reveal = Animation.easeOut(duration: 0.22)
    }
    static let hairline: CGFloat = 1
}

// MARK: - 排版角色（Font extension —— leading-dot 语法需要成员属于 Font）

extension Font {
    /// Fraunces 550 —— 品牌字标、页面标题、关键百分比
    static func qwDisplay(_ size: CGFloat) -> Font {
        .custom("Fraunces", size: size).weight(.medium)
    }
    /// JetBrains Mono —— 数值、倒计时、连接标识（等宽稳定节奏）
    static func qwMono(_ size: CGFloat, _ weight: QWMono = .medium) -> Font {
        .custom(weight.psName, size: size)
    }
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

// MARK: - 配额语义（表盘 / 告警 / 状态点共用）

enum UsageLevel {
    case ok, warn, danger

    /// 设计语义：≥25% accent · 10–24% warning · <10% danger
    init(remainingPct: Double) {
        if remainingPct < 10 { self = .danger }
        else if remainingPct < 25 { self = .warn }
        else { self = .ok }
    }

    var color: Color {
        switch self {
        case .ok: return QWColor.accent
        case .warn: return QWColor.warning
        case .danger: return QWColor.danger
        }
    }

    var label: String {
        switch self {
        case .ok: return "充足"
        case .warn: return "偏紧"
        case .danger: return "告急"
        }
    }
}

// MARK: - 常用布局修饰

/// 主界面统一横向内边距（24–32pt 版面感，列表用 24）
let QWPagePadding: CGFloat = QWTokens.Space.xl

extension View {
    /// 离线 / 失效内容的统一降级：整块 62% 透明度
    func qwStale(_ stale: Bool) -> some View {
        opacity(stale ? 0.62 : 1)
    }
}
