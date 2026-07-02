import SwiftUI

/// Main screen — a dark instrument panel. Custom Fraunces wordmark header, a
/// large hero dial for the most-urgent window, and per-provider cards showing a
/// row of glowing ring gauges (one dial per window).
struct QuotaListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    @State private var pullTick = 0
    @State private var detail: QuotaProvider?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.canvas
                Group {
                    if !model.isConfigured {
                        WelcomeView()
                    } else if model.providers.isEmpty && model.lastUpdated == nil && !model.initialLoadFailed {
                        SkeletonList()
                    } else if model.providers.isEmpty && model.loadError != nil {
                        ErrorStateView(message: model.loadError ?? "加载失败") {
                            Task { await model.refresh() }
                        }
                    } else {
                        scrollContent
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $detail) { ProviderDetailView(provider: $0) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.startAutoRefresh() } else { model.stopAutoRefresh() }
        }
        .task { model.startAutoRefresh() }
        .sensoryFeedback(.impact(weight: .light), trigger: pullTick)
        .sensoryFeedback(.selection, trigger: detail?.id)
        .sensoryFeedback(trigger: model.criticalCount) { old, new in new > old ? .warning : nil }
    }

    private var scrollContent: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                MastheadView(
                    live: model.isPolling,
                    updatedAt: model.lastUpdated,
                    channelCount: model.providers.count,
                    onRefresh: { Task { await model.pollNow() } }
                )
                .padding(.top, 8)

                if model.showAlert {
                    AlertBanner(
                        count: model.criticalCount,
                        urgent: model.criticalWindows.min { $0.window.remainingPct < $1.window.remainingPct },
                        onDismiss: { withAnimation(.snappy) { model.dismissAlert() } }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                if let error = model.loadError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.qwLabel(12))
                        .foregroundStyle(UsageLevel.warn.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(13)
                        .background(UsageLevel.warn.color.opacity(0.10),
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                ForEach(Array(model.providers.enumerated()), id: \.element.id) { idx, provider in
                    ProviderDialCard(provider: provider, index: idx) { detail = provider }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
        .refreshable {
            await model.pollNow()
            pullTick += 1
        }
    }
}

// ── Masthead (custom header with wordmark) ──────────────────────────────

private struct MastheadView: View {
    let live: Bool
    let updatedAt: Date?
    let channelCount: Int
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 0) {
                    Text("quota").font(.qwDisplay(30)).foregroundStyle(Theme.ink)
                    Text("·").font(.qwDisplay(30)).foregroundStyle(UsageLevel.low.color)
                    Text("watch").font(.qwDisplayItalic(30)).foregroundStyle(Theme.ink)
                }
                HStack(spacing: 6) {
                    Circle().fill(live ? UsageLevel.ok.color : Theme.ink3)
                        .frame(width: 6, height: 6)
                    Text(live ? "采集中" : "实时")
                        .font(.qwLabel(10.5)).foregroundStyle(Theme.ink2)
                    if let updatedAt {
                        Text("· \(Formatting.ago(updatedAt)) 前")
                            .font(.qwLabel(10.5)).foregroundStyle(Theme.ink3)
                    }
                    Text("· \(channelCount) 渠道")
                        .font(.qwLabel(10.5)).foregroundStyle(Theme.ink3)
                }
            }
            Spacer()
            HStack(spacing: 10) {
                CircleIconButton(system: "arrow.clockwise", action: onRefresh)
                NavigationLink(destination: SettingsView()) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.ink2)
                        .frame(width: 38, height: 38)
                        .background(Theme.surface, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.hairline))
                }
            }
        }
    }
}

// ── Dismissible alert banner (replaces the permanent alarm hero) ─────────

private struct AlertBanner: View {
    let count: Int
    let urgent: (provider: QuotaProvider, window: QuotaWindow)?
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(UsageLevel.low.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(count) 个窗口告急")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                if let urgent {
                    let reset = Formatting.resetCountdown(urgent.window.resetDate).map { " · \($0)后重置" } ?? ""
                    Text("\(urgent.provider.displayName) · \(urgent.window.windowName) · \(Int(urgent.window.usedPct.rounded()))%\(reset)")
                        .font(.qwLabel(11)).foregroundStyle(Theme.ink2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: 30, height: 30)
                    .background(Color.white.opacity(0.06), in: Circle())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(UsageLevel.low.color.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(UsageLevel.low.color.opacity(0.35)))
        )
        .sensoryFeedback(.impact(weight: .light), trigger: false)
    }
}

private struct CircleIconButton: View {
    let system: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.ink2)
                .frame(width: 38, height: 38)
                .background(Theme.surface, in: Circle())
                .overlay(Circle().strokeBorder(Theme.hairline))
        }
    }
}

// ── Provider card (row of dials) ────────────────────────────────────────

private struct ProviderDialCard: View {
    let provider: QuotaProvider
    var index: Int = 0
    let onTap: () -> Void

    private var style: ProviderStyle { ProviderStyle.of(provider.providerType) }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 11) {
                    ProviderBadge(style: style, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(provider.displayName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                        Text(provider.providerType)
                            .font(.qwLabel(10)).foregroundStyle(Theme.ink3)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                }

                if provider.windows.isEmpty {
                    Text("等待采集…")
                        .font(.qwLabel(12)).foregroundStyle(Theme.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(provider.sortedWindows) { window in
                            DialColumn(window: window)
                        }
                        if provider.sortedWindows.count < 3 {
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(InstrumentCard(shape: RoundedRectangle(cornerRadius: 22, style: .continuous)))
        }
        .buttonStyle(DialCardButtonStyle())
    }
}

private struct DialColumn: View {
    let window: QuotaWindow

    var body: some View {
        let level = UsageLevel(remainingPct: window.remainingPct)
        VStack(spacing: 7) {
            RingGauge(usedPct: window.usedPct, level: level,
                      caption: window.windowKind.label, diameter: 74, lineWidth: 8)
            if let reset = Formatting.resetCountdown(window.resetDate) {
                Text("↻ \(reset)")
                    .font(.qwLabel(10)).foregroundStyle(Theme.ink3)
            } else {
                Text(level.label)
                    .font(.qwLabel(10)).foregroundStyle(level.color)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct DialCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.2), value: configuration.isPressed)
    }
}

// ── Loading / error ─────────────────────────────────────────────────────

private struct SkeletonList: View {
    @State private var shimmer = false
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Theme.surface)
                        .frame(height: 150)
                }
            }
            .padding(.horizontal, 16).padding(.top, 60)
        }
        .scrollIndicators(.hidden)
        .opacity(shimmer ? 0.5 : 1)
        .animation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true), value: shimmer)
        .onAppear { shimmer = true }
        .allowsHitTesting(false)
    }
}

private struct ErrorStateView: View {
    let message: String
    let onRetry: () -> Void
    var body: some View {
        ContentUnavailableView {
            Label("无法加载", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("重试", action: onRetry).buttonStyle(.borderedProminent).tint(UsageLevel.ok.color)
        }
    }
}
