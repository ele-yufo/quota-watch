import SwiftUI

// ─────────────────────────────────────────────────────────────
// 加载 / 错误 / 离线标识 —— 设计文档 03 · 全部状态。
// 文案说清发生了什么、还保留了什么，以及下一步在哪里；
// 刷新保留旧数据并降低透明度，不闪回骨架屏。
// ─────────────────────────────────────────────────────────────

/// 1px hairline —— 编辑版面建立秩序的主结构线
struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(QWColor.border)
            .frame(height: QWTokens.hairline)
    }
}

/// 首次读取加载态：说明在读什么、多久回应，不做骨架屏闪烁
struct LoadingStateView: View {
    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(QWColor.accent)
            Text("正在读取最新配额")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(QWColor.foreground)
            Text("采集器通常会在几秒内回应")
                .font(.system(size: 13))
                .foregroundStyle(QWColor.subtle)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 连接失败与解析失败是两个互斥变体，用具体文案区分
struct ErrorStateView: View {
    let error: APIError?
    let onRetry: () -> Void

    private var isParse: Bool { if case .decoding = error { return true }; return false }

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: isParse ? "doc.text.magnifyingglass" : "wifi.exclamationmark")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(QWColor.warning)
            Text(isParse ? "这次数据没有读懂" : "无法连接到 Mac")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(QWColor.foreground)
            Text(detail)
                .font(.system(size: 14))
                .foregroundStyle(QWColor.subtle)
                .multilineTextAlignment(.center)
            Button(action: onRetry) {
                Text("重试连接")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(QWColor.accentInk)
                    .padding(.horizontal, 22)
                    .frame(height: 46)
                    .background(QWColor.accent,
                                in: RoundedRectangle(cornerRadius: QWTokens.Radius.control + 4, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.top, 14)
        }
        .padding(.horizontal, QWTokens.Space.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var detail: String {
        if isParse {
            return "采集器在线，但返回内容不完整。旧数据仍保留。"
        }
        return error?.errorDescription ?? "检查 daemon 是否已用 --lan 启动，且手机与 Mac 在同一网络。"
    }
}

/// 离线但有缓存 —— 数据继续可读，时效被明确标出
struct StaleBanner: View {
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 11))
                .foregroundStyle(QWColor.subtle)
            Text(updatedAt.map { "离线 · 显示 \(Formatting.ago($0)) 前缓存" } ?? "离线 · 显示最近缓存")
                .font(.system(size: 13))
                .foregroundStyle(QWColor.subtle)
        }
        .padding(.vertical, 10)
    }
}
