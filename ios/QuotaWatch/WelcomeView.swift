import SwiftUI

/// 首次启动 / 未配对 —— 先解释本地优先，再给唯一主操作；
/// 不把端口、token 等实现细节提前暴露给首次使用者。
struct WelcomeView: View {
    @Environment(AppModel.self) private var model

    @State private var showPairing = false
    @State private var pairingMode: PairingMode = .scan
    @State private var appear = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 52)

                HStack(spacing: 0) {
                    Text("quota").font(.qwDisplay(42)).foregroundStyle(QWColor.foreground)
                    Text("—").font(.qwDisplay(42)).foregroundStyle(QWColor.accent)
                    Text("watch").font(.qwDisplay(42)).foregroundStyle(QWColor.foreground)
                }
                .scaleEffect(appear ? 1 : 0.96)
                .opacity(appear ? 1 : 0)

                Text("把 Mac 上的配额，带到随手可看的地方。采集器只在你的 Mac 上读取本地订阅状态；iPhone 只接收你主动配对的摘要。")
                    .font(.system(size: 15))
                    .foregroundStyle(QWColor.muted)
                    .lineSpacing(5)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)
                    .padding(.top, 18)
                    .padding(.bottom, 42)

                Button {
                    pairingMode = .scan
                    showPairing = true
                } label: {
                    Text("扫描 Mac 上的配对码")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(QWColor.accentInk)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(QWColor.accent,
                                    in: RoundedRectangle(cornerRadius: QWTokens.Radius.control + 4, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 32)

                Button {
                    pairingMode = .manual
                    showPairing = true
                } label: {
                    Text("改用 6 位配对码")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(QWColor.foreground)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .overlay(RoundedRectangle(cornerRadius: QWTokens.Radius.control + 4, style: .continuous)
                            .strokeBorder(QWColor.border))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 32)
                .padding(.top, 10)

                Text("配对后约每 10 秒刷新。离线时继续显示最近一次缓存，不上传账号凭据。")
                    .font(.system(size: 12))
                    .foregroundStyle(QWColor.subtle)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.top, 18)

                Button {
                    withAnimation(QWTokens.Motion.reveal) { model.enterDemo() }
                } label: {
                    Text("先看示例数据")
                        .font(.system(size: 13))
                        .foregroundStyle(QWColor.subtle)
                        .padding(.vertical, 24)
                }
                .buttonStyle(.plain)

                Spacer(minLength: 40)
            }
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .sheet(isPresented: $showPairing) {
            PairingSheetView(initialMode: pairingMode)
        }
        .onAppear { withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appear = true } }
    }
}
