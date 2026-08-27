package io.quotawatch.widget

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import io.quotawatch.MainActivity
import io.quotawatch.data.Formatting
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.SharedStore
import io.quotawatch.ui.theme.QWColors
import io.quotawatch.ui.theme.UsageLevel
import java.time.Duration
import java.time.Instant

private fun openApp(context: Context) =
    actionStartActivity(android.content.Intent(context, MainActivity::class.java))

private fun textStyle(size: Int, color: androidx.compose.ui.graphics.Color,
                      weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontSize = size.sp, color = ColorProvider(color), fontWeight = weight)

private fun staleness(at: Instant?, now: Instant = Instant.now()): Boolean =
    at == null || Duration.between(at, now).toMinutes() > 20

/**
 * 小号「精选」小组件 —— 钉住单个渠道（PinProviderConfigActivity 写入
 * pinned_provider），没选时显示最紧张的那个。Fraunces 大数字 + 270° 环
 * 都是预渲染位图。
 */
class FeaturedWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = SharedStore.get(context)
        val snapshot = store.loadSnapshot()
        val mode = store.displayMode
        provideContent {
            val pinned = currentState<androidx.datastore.preferences.core.Preferences>()[
                stringPreferencesKey("pinned_provider")]
            val provider = snapshot?.first
                ?.firstOrNull { it.providerId == pinned }
                ?: snapshot?.first?.mostUrgent()
            Column(
                modifier = GlanceModifier.fillMaxSize()
                    .background(QWColors.Background)
                    .padding(12.dp)
                    .clickable(openApp(context)),
            ) {
                when {
                    store.host.isBlank() -> UnpairedContent()
                    provider == null -> EmptyContent()
                    else -> FeaturedContent(context, provider, mode,
                        stale = staleness(snapshot?.second))
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun FeaturedContent(
        context: Context,
        provider: QuotaProvider,
        mode: QuotaDisplayMode,
        stale: Boolean,
    ) {
        val window = provider.primary ?: return EmptyContent()
        val level = UsageLevel.of(window.remainingPct)
        val fraction = window.displayFraction(mode).toFloat()
        val ring = WidgetBitmaps.ring(
            fraction, QWColors.Surface2.toArgb(), level.color.toArgb(),
            sizePx = 96, strokePx = 9f,
        )
        val pct: Bitmap = WidgetBitmaps.frauncesText(
            context, "${window.displayPct(mode).toInt()}%",
            level.color.toArgb(), textSizePx = 34f,
        )
        Text(provider.displayName, style = textStyle(12, QWColors.Muted, FontWeight.Medium))
        Spacer(GlanceModifier.height(6.dp))
        Box(contentAlignment = Alignment.Center) {
            Image(ImageProvider(ring), contentDescription = null,
                modifier = GlanceModifier.size(64.dp))
            Image(ImageProvider(pct), contentDescription = "${window.displayPct(mode).toInt()}%")
        }
        Spacer(GlanceModifier.height(4.dp))
        Text(
            window.windowKind.displayName +
                (window.resetInstant?.let { Formatting.resetCountdown(it) }
                    ?.let { " · $it 后重置" } ?: ""),
            style = textStyle(11, QWColors.Subtle),
        )
        if (stale) {
            Text("离线缓存", style = textStyle(10, QWColors.Warning))
        }
    }
}

/**
 * 中/大号「一览」小组件 —— 每页 3（中）或 5（大）行，最紧张在前；底部
 * 「下一页」按 glanceId 各自翻页。hero 行带 40dp 环。
 */
class OverviewWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = SharedStore.get(context)
        val snapshot = store.loadSnapshot()
        val mode = store.displayMode
        provideContent {
            val prefs = currentState<androidx.datastore.preferences.core.Preferences>()
            val page = prefs[intPreferencesKey("page")] ?: 0
            val height = androidx.glance.LocalSize.current.height
            val perPage = if (height >= 200.dp) 5 else 3
            Column(
                modifier = GlanceModifier.fillMaxSize()
                    .background(QWColors.Background)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .clickable(openApp(context)),
            ) {
                when {
                    store.host.isBlank() -> UnpairedContent()
                    snapshot == null || snapshot.first.isEmpty() -> EmptyContent()
                    else -> OverviewContent(
                        providers = snapshot.first,
                        mode = mode,
                        perPage = perPage,
                        page = page,
                        stale = staleness(snapshot.second),
                        staleAt = snapshot.second,
                    )
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun OverviewContent(
        providers: List<QuotaProvider>,
        mode: QuotaDisplayMode,
        perPage: Int,
        page: Int,
        stale: Boolean,
        staleAt: Instant,
    ) {
        val worst = providers.sortedBy { it.primary?.remainingPct ?: Double.MAX_VALUE }
        val pages = (worst.size + perPage - 1) / perPage
        val current = page % pages
        val visible = worst.drop(current * perPage).take(perPage)

        Text("配额一览", style = textStyle(13, QWColors.Foreground, FontWeight.Bold))
        if (stale) {
            Text("离线 · 显示 ${Formatting.ago(staleAt)} 前缓存", style = textStyle(10, QWColors.Warning))
        }
        Spacer(GlanceModifier.height(6.dp))
        visible.forEach { provider ->
            OverviewRow(provider, mode)
        }
        Spacer(GlanceModifier.height(8.dp))
        if (pages > 1) {
            Row(GlanceModifier.fillMaxWidth()) {
                Spacer(GlanceModifier.defaultWeight())
                Text(
                    "下一页 ${current + 1}/$pages",
                    style = textStyle(11, QWColors.Accent, FontWeight.Medium),
                    modifier = GlanceModifier.clickable(actionRunCallback<NextPageAction>()),
                )
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun OverviewRow(provider: QuotaProvider, mode: QuotaDisplayMode) {
        val window = provider.primary ?: return
        val level = UsageLevel.of(window.remainingPct)
        val ring = WidgetBitmaps.ring(
            window.displayFraction(mode).toFloat(),
            QWColors.Surface2.toArgb(), level.color.toArgb(),
            sizePx = 48, strokePx = 6f,
        )
        Row(
            modifier = GlanceModifier.fillMaxWidth().padding(vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(ImageProvider(ring), contentDescription = null,
                modifier = GlanceModifier.size(28.dp))
            Spacer(GlanceModifier.width(8.dp))
            Column(GlanceModifier.defaultWeight()) {
                Text(provider.displayName, style = textStyle(12, QWColors.Foreground, FontWeight.Medium))
                Text(
                    window.windowKind.displayName +
                        (window.resetInstant?.let { Formatting.resetCountdown(it) }
                            ?.let { " · $it" } ?: ""),
                    style = textStyle(10, QWColors.Subtle),
                )
            }
            Text("${window.displayPct(mode).toInt()}%${mode.label}", style = textStyle(12, level.color, FontWeight.Bold))
        }
    }
}

/** 翻页 —— 计数存在该 glanceId 的 prefs 里，渲染侧对页数取模。 */
class NextPageAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        updateAppWidgetState(context, PreferencesGlanceStateDefinition, glanceId) { prefs ->
            val key = intPreferencesKey("page")
            prefs.toMutablePreferences().apply {
                this[key] = (this[key] ?: 0) + 1
            }.toPreferences()
        }
        OverviewWidget().update(context, glanceId)
    }
}

@androidx.compose.runtime.Composable
private fun UnpairedContent() {
    Column(GlanceModifier.fillMaxSize()) {
        Text("quota—watch", style = textStyle(13, QWColors.Foreground, FontWeight.Bold))
        Spacer(GlanceModifier.height(6.dp))
        Text("未配对 — 打开 App 扫描 Mac 上的配对码", style = textStyle(11, QWColors.Muted))
    }
}

@androidx.compose.runtime.Composable
private fun EmptyContent() {
    Column(GlanceModifier.fillMaxSize()) {
        Text("quota—watch", style = textStyle(13, QWColors.Foreground, FontWeight.Bold))
        Spacer(GlanceModifier.height(6.dp))
        Text("等待采集…", style = textStyle(11, QWColors.Muted))
    }
}

/** 全列表里最紧张的渠道（primary 最小 remainingPct）。 */
private fun List<QuotaProvider>.mostUrgent(): QuotaProvider? =
    filter { it.primary != null }.minByOrNull { it.primary!!.remainingPct }
