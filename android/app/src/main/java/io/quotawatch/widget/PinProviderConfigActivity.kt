package io.quotawatch.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.SharedStore
import io.quotawatch.ui.components.ProviderBadge
import io.quotawatch.ui.theme.ProviderStyles
import io.quotawatch.ui.theme.QWDarkColorScheme
import io.quotawatch.ui.theme.QWColors
import io.quotawatch.ui.theme.FrauncesFamily
import kotlinx.coroutines.runBlocking

/**
 * 添加「精选」小组件时的配置页：选一个钉住的渠道（也可选「自动 · 最紧张」）。
 * 选择写入该 glanceId 的 prefs，FeaturedWidget 渲染时读取。
 */
class PinProviderConfigActivity : ComponentActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        setResult(RESULT_CANCELED)

        val providers = SharedStore.get(this).loadSnapshot()?.first ?: emptyList()
        setContent {
            MaterialTheme(colorScheme = QWDarkColorScheme) {
                PinPicker(providers, onPick = ::pin)
            }
        }
    }

    private fun pin(providerId: String?) {
        val manager = GlanceAppWidgetManager(this)
        runBlocking {
            val glanceId = manager.getGlanceIdBy(appWidgetId)
            updateAppWidgetState(this@PinProviderConfigActivity,
                PreferencesGlanceStateDefinition, glanceId) { prefs ->
                prefs.toMutablePreferences().apply {
                val key = stringPreferencesKey("pinned_provider")
                if (providerId == null) remove(key) else this[key] = providerId
                }.toPreferences()
            }
            FeaturedWidget().update(this@PinProviderConfigActivity, glanceId)
        }
        setResult(RESULT_OK, Intent().putExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        finish()
    }
}

@Composable
private fun PinPicker(providers: List<QuotaProvider>, onPick: (String?) -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Text("钉住哪个渠道？", fontFamily = FrauncesFamily, fontSize = 24.sp,
            color = QWColors.Foreground, modifier = Modifier.padding(bottom = 4.dp))
        Text("小组件只显示这一个渠道；选「自动」则始终显示最紧张的。",
            fontSize = 13.sp, color = QWColors.Muted,
            modifier = Modifier.padding(bottom = 16.dp))
        PinRow(label = "自动 · 最紧张", subtitle = null, providerType = null,
            onClick = { onPick(null) })
        providers.forEach { p ->
            PinRow(label = p.displayName,
                subtitle = p.primary?.let { "${it.windowKind.displayName} · 剩 ${it.remainingPct.toInt()}%" },
                providerType = p.providerType,
                onClick = { onPick(p.providerId) })
        }
    }
}

@Composable
private fun PinRow(
    label: String,
    subtitle: String?,
    providerType: String?,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (providerType != null) {
            ProviderBadge(ProviderStyles.of(providerType), 34.dp)
            Spacer(Modifier.width(12.dp))
        }
        Column {
            Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                color = QWColors.Foreground)
            subtitle?.let { Text(it, fontSize = 12.sp, color = QWColors.Subtle) }
        }
    }
}
