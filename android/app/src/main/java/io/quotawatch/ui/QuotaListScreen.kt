package io.quotawatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.data.Formatting
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.QuotaWindow
import io.quotawatch.ui.components.ErrorStateView
import io.quotawatch.ui.components.Hairline
import io.quotawatch.ui.components.IconCircle
import io.quotawatch.ui.components.LoadingStateView
import io.quotawatch.ui.components.ProviderBadge
import io.quotawatch.ui.components.RingGauge
import io.quotawatch.ui.components.StaleBanner
import io.quotawatch.ui.components.qwStale
import io.quotawatch.ui.theme.FrauncesFamily
import io.quotawatch.ui.theme.JetBrainsMonoFamily
import io.quotawatch.ui.theme.ProviderStyles
import io.quotawatch.ui.theme.QWColors
import io.quotawatch.ui.theme.UsageLevel

/**
 * 主界面 —— 开放版面替代卡片墙（port of QuotaListView）。
 * 顶部：页面标题 + 全局视角分段；最紧张窗口置顶（大表盘）；下方 hairline
 * 分隔的 provider 列表行。
 */
@Composable
fun QuotaListScreen(
    state: QuotaUiState,
    onOpenDetail: (QuotaProvider) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenPairing: (Boolean) -> Unit, // true = scan tab, false = manual
    onPollNow: () -> Unit,
    onRefresh: () -> Unit,
    onToggleMode: () -> Unit,
    onDismissAlert: () -> Unit,
    onDemo: () -> Unit,
) {
    when {
        !state.isConfigured -> WelcomeScreen(
            onScanPairing = { onOpenPairing(true) },
            onManualPairing = { onOpenPairing(false) },
            onDemo = onDemo,
        )
        state.providers.isEmpty() && state.lastUpdated == null && !state.initialLoadFailed ->
            LoadingStateView()
        state.providers.isEmpty() ->
            ErrorStateView(state.lastError, onRetry = onRefresh)
        else -> QuotaContent(state, onOpenDetail, onOpenSettings, onPollNow,
            onToggleMode, onDismissAlert)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuotaContent(
    state: QuotaUiState,
    onOpenDetail: (QuotaProvider) -> Unit,
    onOpenSettings: () -> Unit,
    onPollNow: () -> Unit,
    onToggleMode: () -> Unit,
    onDismissAlert: () -> Unit,
) {
    val pullState = rememberPullToRefreshState()
    val stale = state.loadError != null

    PullToRefreshBox(
        isRefreshing = state.isPolling,
        onRefresh = onPollNow,
        state = pullState,
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 40.dp),
        ) {
            // ── Title row ──
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("配额", fontFamily = FrauncesFamily, fontSize = 34.sp,
                    color = QWColors.Foreground)
                Spacer(Modifier.weight(1f))
                ModeSegment(state.displayMode, onToggleMode)
            }

            // ── Status row ──
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                androidx.compose.foundation.Canvas(Modifier.size(6.dp)) {
                    drawCircle(if (state.isPolling) QWColors.Success else QWColors.Muted)
                }
                Spacer(Modifier.width(6.dp))
                Text(if (state.isPolling) "采集中" else "实时",
                    color = QWColors.Muted, fontSize = 13.sp)
                state.lastUpdated?.let {
                    Text("· ${Formatting.ago(it)} 前",
                        fontFamily = JetBrainsMonoFamily, fontSize = 11.sp,
                        color = QWColors.Subtle)
                }
                Spacer(Modifier.weight(1f))
                IconCircle(onClick = onPollNow) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新",
                        tint = QWColors.Muted, modifier = Modifier.size(16.dp))
                }
                IconCircle(onClick = onOpenSettings) {
                    Icon(Icons.Outlined.Settings, contentDescription = "设置",
                        tint = QWColors.Muted, modifier = Modifier.size(16.dp))
                }
            }

            Hairline()

            if (state.showAlert) {
                QuotaAlert(state, onDismissAlert)
            }
            if (stale) {
                StaleBanner(state.lastUpdated)
            }

            state.mostUrgent?.let { (provider, window) ->
                HeroWindow(provider, window, state.displayMode,
                    modifier = Modifier.qwStale(stale),
                    onTap = { onOpenDetail(provider) })
            }

            // ── Provider list ──
            Column(Modifier.qwStale(stale)) {
                state.providers.forEachIndexed { idx, provider ->
                    if (idx > 0) Hairline()
                    ProviderRow(provider, state.displayMode, onTap = { onOpenDetail(provider) })
                }
            }
        }
    }
}

// ── 标题行：全局视角分段（剩余 / 已用） ─────────────────────────────────

@Composable
private fun ModeSegment(mode: QuotaDisplayMode, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .padding(2.dp),
    ) {
        QuotaDisplayMode.entries.forEach { m ->
            val selected = m == mode
            Box(
                modifier = Modifier
                    .width(68.dp)
                    .height(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (selected) QWColors.Accent else QWColors.Surface)
                    .clickable(enabled = !selected, onClick = onToggle),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    m.label,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (selected) QWColors.AccentInk else QWColors.Muted,
                )
            }
        }
    }
}

// ── 告警：插入信息流的一段短消息，不是圆角卡片 ──────────────────────────

@Composable
private fun QuotaAlert(state: QuotaUiState, onDismiss: () -> Unit) {
    val urgent = state.criticalWindows.minByOrNull { it.second.remainingPct }
    val headline = if (urgent == null) {
        "${state.criticalCount} 个窗口额度告急"
    } else {
        val pct = urgent.second.displayPct(state.displayMode).toInt()
        if (state.criticalCount > 1) {
            "${state.criticalCount} 个窗口告急 · 最紧张 ${urgent.first.displayName} ${urgent.second.windowKind.displayName} 只剩 $pct%"
        } else {
            "${urgent.first.displayName} ${urgent.second.windowKind.displayName}额度只剩 $pct%"
        }
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(headline, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                color = QWColors.Danger, modifier = Modifier.weight(1f))
            DismissAlertButton(onClick = onDismiss)
        }
        urgent?.second?.resetInstant?.let { reset ->
            Formatting.resetCountdown(reset)?.let { countdown ->
                Row(Modifier.padding(top = 4.dp)) {
                    Text(countdown, fontFamily = JetBrainsMonoFamily,
                        fontWeight = FontWeight.Bold, fontSize = 12.sp, color = QWColors.Muted)
                    Text(" 后重置 · 已置顶", fontSize = 13.sp, color = QWColors.Subtle)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Hairline()
    }
}

@Composable
private fun DismissAlertButton(onClick: () -> Unit) {
    androidx.compose.material3.IconButton(onClick = onClick, modifier = Modifier.size(32.dp)) {
        Icon(Icons.Outlined.Close, contentDescription = "消除告警",
            tint = QWColors.Subtle, modifier = Modifier.size(14.dp))
    }
}

// ── 最紧张窗口（hero）：大表盘 + 编辑级数字 ─────────────────────────────

@Composable
private fun HeroWindow(
    provider: QuotaProvider,
    window: QuotaWindow,
    mode: QuotaDisplayMode,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
) {
    val level = UsageLevel.of(window.remainingPct)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onTap)
            .padding(vertical = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        RingGauge(
            fraction = window.displayFraction(mode).toFloat(),
            level = level,
            diameter = 116.dp,
        )
        Column {
            Text("${provider.displayName} · 最紧张窗口", fontSize = 13.sp, color = QWColors.Subtle)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "${window.displayPct(mode).toInt()}",
                    fontFamily = FrauncesFamily, fontSize = 44.sp, color = level.color,
                )
                Spacer(Modifier.width(6.dp))
                Text(mode.label, fontFamily = FrauncesFamily, fontSize = 20.sp,
                    color = QWColors.Muted, modifier = Modifier.padding(bottom = 6.dp))
            }
            window.resetInstant?.let { reset ->
                Formatting.resetCountdown(reset)?.let { countdown ->
                    Row(Modifier.padding(top = 5.dp)) {
                        Text(window.windowKind.wire.uppercase(),
                            fontFamily = JetBrainsMonoFamily, fontWeight = FontWeight.Bold,
                            fontSize = 11.sp, color = QWColors.Muted)
                        Text(" · $countdown 后重置",
                            fontFamily = JetBrainsMonoFamily, fontSize = 12.sp,
                            color = QWColors.Subtle)
                    }
                }
            }
        }
    }
}

// ── Provider 列表行 ─────────────────────────────────────────────────────

@Composable
private fun ProviderRow(provider: QuotaProvider, mode: QuotaDisplayMode, onTap: () -> Unit) {
    val style = ProviderStyles.of(provider.providerType)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clickable(onClick = onTap)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProviderBadge(style, 34.dp)
        Column(Modifier.weight(1f)) {
            Text(provider.displayName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                color = QWColors.Foreground)
            val w = provider.primary
            if (w != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(w.windowKind.displayName, fontSize = 13.sp, color = QWColors.Muted)
                    w.resetInstant?.let { reset ->
                        Formatting.resetCountdown(reset)?.let { countdown ->
                            Text(" · $countdown 后重置",
                                fontFamily = JetBrainsMonoFamily, fontSize = 11.sp,
                                color = QWColors.Subtle)
                        }
                    }
                }
            } else {
                Text("等待采集…", fontSize = 13.sp, color = QWColors.Subtle)
            }
        }
        provider.primary?.let { w ->
            RingGauge(
                fraction = w.displayFraction(mode).toFloat(),
                level = UsageLevel.of(w.remainingPct),
                diameter = 40.dp,
                lineWidth = 5.dp,
            )
        }
    }
}
