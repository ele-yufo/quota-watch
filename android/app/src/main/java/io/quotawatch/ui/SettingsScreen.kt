package io.quotawatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.data.Formatting
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.ui.components.Hairline
import io.quotawatch.ui.theme.FrauncesFamily
import io.quotawatch.ui.theme.JetBrainsMonoFamily
import io.quotawatch.ui.theme.QWColors
import kotlinx.coroutines.launch

/** 设置 —— port of SettingsView:连接 / 配对另一台 Mac / 监控 / 显示 / Demo / 关于。 */
@Composable
fun SettingsScreen(
    state: QuotaUiState,
    version: String,
    onTestConnection: suspend () -> Result<Int>, // provider count on success
    onOpenPairing: () -> Unit,
    onSetDisplayMode: (QuotaDisplayMode) -> Unit,
    onToggleDemo: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 40.dp),
    ) {
        Text("设置", fontFamily = FrauncesFamily, fontSize = 34.sp,
            color = QWColors.Foreground, modifier = Modifier.padding(vertical = 16.dp))

        ConnectionSection(state, onTestConnection)
        PairAnotherMacSection(onOpenPairing)
        MonitorSection()
        DisplaySection(state.displayMode, onSetDisplayMode)
        DemoSection(state.demoMode, onToggleDemo)
        AboutSection(version)
    }
}

// ── 连接 ────────────────────────────────────────────────────────────────

private sealed class TestState {
    data object Idle : TestState()
    data object Running : TestState()
    data class Ok(val providers: Int) : TestState()
    data class Failed(val message: String) : TestState()
}

@Composable
private fun ConnectionSection(
    state: QuotaUiState,
    onTestConnection: suspend () -> Result<Int>,
) {
    var test by remember { mutableStateOf<TestState>(TestState.Idle) }
    val scope = rememberCoroutineScope()

    SectionHeader("连接")
    SettingRow("Host", state.host.ifEmpty { "未设置" }, mono = true)
    SettingRow("Token", maskedToken(state.token), mono = true)
    state.lastUpdated?.let {
        SettingRow("最近同步", "${Formatting.ago(it)} 前")
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            onClick = {
                test = TestState.Running
                scope.launch {
                    test = onTestConnection().fold(
                        onSuccess = { TestState.Ok(it) },
                        onFailure = { TestState.Failed(it.message ?: "失败") },
                    )
                }
            },
            enabled = test !is TestState.Running && state.isConfigured,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = QWColors.Surface,
                contentColor = QWColors.Foreground,
            ),
        ) {
            if (test is TestState.Running) {
                CircularProgressIndicator(Modifier.size(14.dp),
                    color = QWColors.Muted, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text("测试连接", fontSize = 14.sp)
        }
        Spacer(Modifier.width(12.dp))
        when (val t = test) {
            is TestState.Ok -> Text("${t.providers} 渠道 · 在线",
                fontSize = 13.sp, color = QWColors.Success)
            is TestState.Failed -> Text("测试失败：${t.message}",
                fontSize = 13.sp, color = QWColors.Danger)
            else -> Text(
                when {
                    state.host.isEmpty() -> "未连接"
                    else -> "已配置，未测试"
                },
                fontSize = 13.sp, color = QWColors.Subtle,
            )
        }
    }
}

private fun maskedToken(token: String): String = when {
    token.isEmpty() -> "未设置"
    token.length <= 8 -> "••••"
    else -> token.take(3) + "••••••••" + token.takeLast(4)
}

// ── 配对另一台 Mac ───────────────────────────────────────────────────────

@Composable
private fun PairAnotherMacSection(onOpenPairing: () -> Unit) {
    SectionHeader("配对另一台 Mac")
    Text(
        "在新 Mac 上启动采集器并打开「配对」，然后在这里扫码或输入配对码 —— 会替换当前连接。",
        fontSize = 13.sp, color = QWColors.Muted, lineHeight = 19.sp,
    )
    Button(
        onClick = onOpenPairing,
        modifier = Modifier.padding(top = 12.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = QWColors.Accent,
            contentColor = QWColors.AccentInk,
        ),
    ) {
        Text("扫描或输入配对码", fontSize = 14.sp)
    }
}

// ── 监控 / 显示 / Demo / 关于 ────────────────────────────────────────────

@Composable
private fun MonitorSection() {
    SectionHeader("监控")
    SettingRow("自动刷新", "近实时 · 每 10 秒")
    SettingRow("低配额提醒", "剩余低于 10% 置顶")
}

@Composable
private fun DisplaySection(mode: QuotaDisplayMode, onSet: (QuotaDisplayMode) -> Unit) {
    SectionHeader("显示")
    SettingRow("外观", "深色（唯一主题）")
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("默认视角", fontSize = 15.sp, color = QWColors.Foreground)
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            QuotaDisplayMode.entries.forEach { m ->
                val selected = m == mode
                Text(
                    m.label,
                    fontSize = 13.sp,
                    color = if (selected) QWColors.AccentInk else QWColors.Muted,
                    modifier = Modifier
                        .background(
                            if (selected) QWColors.Accent else QWColors.Surface,
                            RoundedCornerShape(8.dp),
                        )
                        .clickable { onSet(m) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun DemoSection(demoMode: Boolean, onToggle: () -> Unit) {
    SectionHeader("Demo 模式")
    Text(
        if (demoMode) "Demo 模式 · 未连接采集器" else "使用示例数据，不连接采集器",
        fontSize = 13.sp, color = QWColors.Muted,
    )
    Button(
        onClick = onToggle,
        modifier = Modifier.padding(top = 10.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = QWColors.Surface,
            contentColor = QWColors.Foreground,
        ),
    ) {
        Text(if (demoMode) "退出示例模式" else "进入示例模式", fontSize = 14.sp)
    }
}

@Composable
private fun AboutSection(version: String) {
    SectionHeader("关于")
    SettingRow("版本", version)
    Text(
        "配额数据只在你的局域网 / 隧道内传输，不经任何云端。",
        fontSize = 12.sp, color = QWColors.Subtle, lineHeight = 18.sp,
        modifier = Modifier.padding(top = 8.dp),
    )
}

// ── 基础件 ──────────────────────────────────────────────────────────────

@Composable
private fun SectionHeader(title: String) {
    Column(Modifier.fillMaxWidth().padding(top = 28.dp)) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            color = QWColors.Subtle)
        Spacer(Modifier.height(8.dp))
        Hairline()
    }
}

@Composable
private fun SettingRow(label: String, value: String, mono: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 15.sp, color = QWColors.Foreground)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            fontSize = 14.sp,
            fontFamily = if (mono) JetBrainsMonoFamily else null,
            color = QWColors.Muted,
        )
    }
}
