import SwiftUI

/// 配额表盘 —— 270° 开口弧形（底部留口），不使用完整圆环。
/// 尺寸 116 / 84 / 54 / 40；弧线 7pt 端点 round；轨道只比 surface
/// 深一级。中心数字与弧线同用配额语义色。
struct RingGauge: View {
    let pct: Double
    let level: UsageLevel
    /// 中心数字下方的短标签（如窗口类型 "SESSION"）；nil 隐藏
    var caption: String? = nil
    var diameter: CGFloat = 84
    var lineWidth: CGFloat = 7
    var showNumber: Bool = true
    /// Widget 渲染静态快照，必须传 false 让弧直接画到终值
    var animated: Bool = true

    @State private var sweep: Double = 0

    private var fraction: Double { max(0, min(1, pct / 100)) }
    /// 中心内容保持在这个内圆内，永不触及弧线
    private var contentDiameter: CGFloat { diameter - lineWidth * 2 - diameter * 0.14 }

    var body: some View {
        ZStack {
            // 轨道：270° 开口弧（底部 90° 留口），只比 surface 深一级
            Arc(from: 0.125, to: 0.875)
                .stroke(QWColor.surface2, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            // 进度弧
            Arc(from: 0.125, to: 0.125 + (animated ? sweep : fraction) * 0.75)
                .stroke(
                    level.color,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )

            if showNumber {
                VStack(spacing: diameter * 0.02) {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(Int(pct.rounded()))")
                            .font(.qwMono(diameter * 0.24, .bold))
                            .foregroundStyle(level.color)
                            .contentTransition(.numericText(value: pct))
                            .animation(QWTokens.Motion.number, value: pct)
                        Text("%")
                            .font(.qwMono(diameter * 0.12, .medium))
                            .foregroundStyle(QWColor.muted)
                    }
                    if let caption {
                        Text(caption)
                            .font(.qwMono(diameter * 0.125))
                            .foregroundStyle(QWColor.muted)
                    }
                }
                .frame(width: contentDiameter, height: contentDiameter)
                .minimumScaleFactor(0.7)
            }
        }
        .frame(width: diameter, height: diameter)
        .onAppear {
            guard animated else { return }
            withAnimation(QWTokens.Motion.reveal) { sweep = fraction }
        }
        .onChange(of: fraction) { _, new in
            guard animated else { return }
            withAnimation(QWTokens.Motion.reveal) { sweep = new }
        }
    }
}

/// 270° 开口弧线路径 —— from/to 为圆上比例（0 = 12 点方向，顺时针）。
/// 0.125 → 0.875 覆盖 270°，正下方留口。
private struct Arc: Shape {
    var from: Double
    var to: Double

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        let start = Angle.degrees(from * 360 - 90)
        let end = Angle.degrees(to * 360 - 90)
        p.addArc(center: center, radius: radius,
                 startAngle: start, endAngle: end, clockwise: false)
        return p
    }
}
