import SwiftUI

/// A clean usage dial: a thin track, a single refined progress arc, and a
/// centred numeral. Proportions are chosen so even "100%" clears the ring with
/// margin — the number never touches the arc. Restraint over decoration.
struct RingGauge: View {
    let usedPct: Double
    let level: UsageLevel
    /// caption under the number (e.g. the kind label "5h"); nil hides it
    var caption: String? = nil
    var diameter: CGFloat = 78
    var lineWidth: CGFloat = 6
    var showNumber: Bool = true

    @State private var sweep: Double = 0

    private var fraction: Double { max(0, min(1, usedPct / 100)) }
    /// centre content is kept within this inner circle so it never meets the arc
    private var contentDiameter: CGFloat { diameter - lineWidth * 2 - diameter * 0.14 }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.08), lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: sweep)
                .stroke(
                    LinearGradient(colors: [level.color.opacity(0.7), level.color],
                                   startPoint: .top, endPoint: .trailing),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))

            if showNumber {
                VStack(spacing: diameter * 0.02) {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(Int(usedPct.rounded()))")
                            .font(.qwNum(diameter * 0.24, .bold))
                            .foregroundStyle(Theme.ink)
                            .contentTransition(.numericText(value: usedPct))
                            .animation(.snappy, value: usedPct)
                        Text("%")
                            .font(.qwNum(diameter * 0.12, .medium))
                            .foregroundStyle(Theme.ink3)
                    }
                    if let caption {
                        Text(caption)
                            .font(.qwLabel(diameter * 0.125))
                            .foregroundStyle(Theme.ink3)
                    }
                }
                .frame(width: contentDiameter, height: contentDiameter)
                .minimumScaleFactor(0.7)
            }
        }
        .frame(width: diameter, height: diameter)
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) { sweep = fraction }
        }
        .onChange(of: fraction) { _, new in
            withAnimation(.easeOut(duration: 0.4)) { sweep = new }
        }
    }
}
