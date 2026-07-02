import SwiftUI

/// First-run welcome — dark instrument aesthetic, brand wordmark, routes into
/// the pairing flow. Reachable inside the main NavigationStack.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @State private var appear = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 44)

                // a decorative hero dial as the brand mark
                RingGauge(usedPct: 65, level: .ok, diameter: 120, lineWidth: 12, showNumber: false)
                    .overlay(
                        Image(systemName: "gauge.with.dots.needle.67percent")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                    )
                    .scaleEffect(appear ? 1 : 0.85)
                    .opacity(appear ? 1 : 0)
                    .padding(.bottom, 22)

                HStack(spacing: 0) {
                    Text("quota").font(.qwDisplay(34)).foregroundStyle(Theme.ink)
                    Text("·").font(.qwDisplay(34)).foregroundStyle(UsageLevel.low.color)
                    Text("watch").font(.qwDisplayItalic(34)).foregroundStyle(Theme.ink)
                }
                Text("盯住每个 AI 订阅的配额")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.top, 6)
                    .padding(.bottom, 36)

                VStack(spacing: 16) {
                    FeatureRow(symbol: "bolt.fill", tint: UsageLevel.warn.color,
                               title: "近实时",
                               detail: "连接你 Mac 上的 quota-watch，约 10 秒刷新一次")
                    FeatureRow(symbol: "gauge.with.dots.needle.50percent", tint: ProviderStyle.of("glm-cn").accent,
                               title: "多渠道一屏",
                               detail: "Claude / Codex / GLM / Kimi 等用量一眼看全")
                    FeatureRow(symbol: "lock.fill", tint: UsageLevel.ok.color,
                               title: "只连你自己的设备",
                               detail: "数据只在你的局域网 / 隧道里传，不经任何云端")
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)

                NavigationLink(destination: SettingsView()) {
                    Text("开始配对")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(UsageLevel.ok.color, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                        .foregroundStyle(Color.black)
                }
                .padding(.horizontal, 22)

                Button {
                    withAnimation(.snappy) { model.enterDemo() }
                } label: {
                    Text("先看示例数据")
                        .font(.system(size: 15, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).strokeBorder(Theme.hairline))
                        .foregroundStyle(Theme.ink2)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)

                Text("在 Mac 上运行 quota-watch connect --qr，扫码即可")
                    .font(.qwLabel(11))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                    .padding(.top, 14).padding(.horizontal, 30)

                Spacer(minLength: 44)
            }
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appear = true } }
    }
}

private struct FeatureRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous).fill(tint.opacity(0.16))
                Image(systemName: symbol).font(.system(size: 17, weight: .semibold)).foregroundStyle(tint)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                Text(detail).font(.qwLabel(11)).foregroundStyle(Theme.ink2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(InstrumentCard(shape: RoundedRectangle(cornerRadius: 16, style: .continuous)))
    }
}
