package io.quotawatch.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.data.Formatting
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.QuotaWindow
import io.quotawatch.ui.components.Hairline
import io.quotawatch.ui.components.ProviderBadge
import io.quotawatch.ui.components.RingGauge
import io.quotawatch.ui.components.qwStale
import io.quotawatch.ui.theme.FrauncesFamily
import io.quotawatch.ui.theme.JetBrainsMonoFamily
import io.quotawatch.ui.theme.ProviderStyles
import io.quotawatch.ui.theme.QWColors
import io.quotawatch.ui.theme.UsageLevel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * 单个订阅详情 —— 每个窗口是独立的信息段（hairline 分隔），不是独立卡片。
 * 阅读顺序统一：表盘 → 窗口名 → 用量 → 重置（port of ProviderDetailView）。
 */
@Composable
fun ProviderDetailScreen(
    provider: QuotaProvider,
    mode: QuotaDisplayMode,
    demoMode: Boolean,
    lastUpdated: Instant?,
    stale: Boolean,
) {
    val style = ProviderStyles.of(provider.providerType)
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 30.dp),
    ) {
        // ── Header ──
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            ProviderBadge(style, 44.dp)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(provider.displayName, fontFamily = FrauncesFamily, fontSize = 20.sp,
                    color = QWColors.Foreground)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (demoMode) DemoTag()
                    if (lastUpdated != null) {
                        Text("刚刚同步", fontSize = 12.sp, color = QWColors.Subtle)
                    }
                }
            }
        }

        if (provider.windows.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Outlined.DateRange, contentDescription = null,
                    tint = QWColors.Muted, modifier = Modifier.size(32.dp))
                Text("等待采集", color = QWColors.Foreground, fontSize = 16.sp,
                    modifier = Modifier.padding(top = 14.dp))
                Text("daemon 还没为该渠道采集到数据", color = QWColors.Muted, fontSize = 13.sp,
                    modifier = Modifier.padding(top = 6.dp))
            }
        } else {
            Column(Modifier.qwStale(stale)) {
                provider.sortedWindows.forEachIndexed { idx, window ->
                    if (idx > 0) Hairline(Modifier.padding(vertical = 8.dp))
                    WindowSegment(window, mode)
                }
            }
        }
    }
}

@Composable
private fun DemoTag() {
    Text(
        "DEMO DATA",
        fontFamily = JetBrainsMonoFamily, fontWeight = FontWeight.Bold, fontSize = 10.sp,
        color = QWColors.Warning,
        modifier = Modifier
            .border(1.dp, QWColors.Warning.copy(alpha = 0.6f), RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

// ── 窗口信息段 ──────────────────────────────────────────────────────────

@Composable
private fun WindowSegment(window: QuotaWindow, mode: QuotaDisplayMode) {
    val level = UsageLevel.of(window.remainingPct)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        RingGauge(
            fraction = window.displayFraction(mode).toFloat(),
            level = level,
            diameter = 84.dp,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${window.displayPct(mode).toInt()}%",
                    fontFamily = FrauncesFamily, fontSize = 18.sp, color = level.color)
                Text(mode.label, fontSize = 10.sp, color = QWColors.Subtle)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(cleanName(window), fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                color = QWColors.Foreground)
            if (window.unit != "percent") {
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(fmt(window.used), fontFamily = JetBrainsMonoFamily,
                        fontWeight = FontWeight.Bold, fontSize = 13.sp,
                        color = QWColors.Foreground)
                    Text("/ ${fmt(window.total)} ${window.unit}",
                        fontFamily = JetBrainsMonoFamily, fontSize = 13.sp,
                        color = QWColors.Subtle)
                }
            }
            window.resetInstant?.let { reset ->
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("重置", fontSize = 12.sp, color = QWColors.Subtle)
                    Text(absoluteReset(reset), fontFamily = JetBrainsMonoFamily,
                        fontSize = 12.sp, color = QWColors.Muted)
                }
            }
        }
    }
}

/** "session (5h)" → "Session"；没有窗口名时退回类型中文。 */
private fun cleanName(window: QuotaWindow): String {
    val trimmed = Formatting.cleanWindowName(window.windowName).trim()
    return if (trimmed.isNotEmpty()) {
        trimmed.replaceFirstChar { it.uppercase() }
    } else {
        window.windowKind.displayName
    }
}

private fun fmt(v: Double): String = when {
    v >= 1_000_000 -> "%.1fM".format(v / 1_000_000)
    v >= 1_000 -> "%.1fK".format(v / 1_000)
    v == Math.floor(v) -> "%.0f".format(v)
    else -> "%.1f".format(v)
}

private val zhLocale = Locale("zh", "CN")
private val withinWeekFormat = DateTimeFormatter.ofPattern("E HH:mm", zhLocale)
private val farFormat = DateTimeFormatter.ofPattern("M 月 d 日", zhLocale)

/** 7 天内：周几 HH:mm；更远：M 月 d 日。倒计时补全大写。 */
private fun absoluteReset(date: Instant): String {
    val now = Instant.now()
    val days = ChronoUnit.DAYS.between(now, date)
    val zoned = date.atZone(ZoneId.systemDefault())
    val abs = (if (days <= 7) withinWeekFormat else farFormat).format(zoned)
    val rel = Formatting.resetCountdown(date, now)?.uppercase() ?: ""
    return "$abs · $rel"
}
