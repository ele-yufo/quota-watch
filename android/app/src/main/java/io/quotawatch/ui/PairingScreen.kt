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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.net.FingerprintPin
import io.quotawatch.net.PairingPayload
import io.quotawatch.ui.theme.FrauncesFamily
import io.quotawatch.ui.theme.JetBrainsMonoFamily
import io.quotawatch.ui.theme.QWColors
import kotlinx.coroutines.launch

/**
 * 配对 Mac —— 扫描 / 手动双 tab（port of PairingSheetView）。
 * 与 iOS 的差异：手动配对必须填证书指纹（daemon 只讲 HTTPS，没有降级通道）。
 */
@Composable
fun PairingScreen(
    initialTab: PairingTab,
    onScanned: suspend (PairingPayload) -> String?,   // null = success
    onClaimManual: suspend (host: String, port: Int, code: String, fp: String) -> String?,
    onDone: () -> Unit,
) {
    var tab by remember { mutableStateOf(initialTab) }
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
        Text("配对 Mac", fontFamily = FrauncesFamily, fontSize = 34.sp,
            color = QWColors.Foreground, modifier = Modifier.padding(vertical = 16.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .background(QWColors.Surface, RoundedCornerShape(10.dp))
                .padding(2.dp),
        ) {
            PairingTab.entries.forEach { t ->
                val selected = t == tab
                Box(
                    Modifier
                        .weight(1f)
                        .height(38.dp)
                        .background(
                            if (selected) QWColors.Accent else QWColors.Surface,
                            RoundedCornerShape(8.dp),
                        )
                        .clickable { tab = t },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(t.label, fontSize = 14.sp, fontWeight = FontWeight.Medium,
                        color = if (selected) QWColors.AccentInk else QWColors.Muted)
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        when (tab) {
            PairingTab.SCAN -> ScanTab(onScanned, onDone)
            PairingTab.MANUAL -> ManualTab(onClaimManual, onDone)
        }
    }
}

enum class PairingTab(val label: String) { SCAN("扫描配对码"), MANUAL("手动配对") }

// ── 扫描 tab ────────────────────────────────────────────────────────────

@Composable
private fun ScanTab(
    onScanned: suspend (PairingPayload) -> String?,
    onDone: () -> Unit,
) {
    var scanning by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    if (scanning) {
        QrScannerView(
            onResult = { raw ->
                val payload = PairingPayload.parse(raw)
                if (payload == null) {
                    error = "不是 quota-watch 配对码 — 请扫描 Mac 配对面板上的二维码"
                    scanning = false
                    return@QrScannerView
                }
                if (payload.caFingerprint == null) {
                    error = "二维码缺少证书指纹 — 请在 Mac 上重新打开配对面板"
                    scanning = false
                    return@QrScannerView
                }
                scanning = false
                busy = true
                scope.launch {
                    val msg = onScanned(payload)
                    busy = false
                    if (msg == null) onDone() else error = msg
                }
            },
            onCancel = { scanning = false },
        )
        return
    }

    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Text("将 Mac 上的配对码放入框内", fontSize = 16.sp, color = QWColors.Foreground)
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { error = null; scanning = true },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = QWColors.Accent, contentColor = QWColors.AccentInk),
        ) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(16.dp),
                    color = QWColors.AccentInk, strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
            }
            Text(if (busy) "正在连接…" else "开始扫描", fontSize = 17.sp)
        }
        Spacer(Modifier.height(14.dp))
        Text("使用相机识别二维码；画面不会保存。",
            fontSize = 12.sp, color = QWColors.Subtle)
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, fontSize = 13.sp, color = QWColors.Danger)
        }
    }
}

// ── 手动 tab ────────────────────────────────────────────────────────────

@Composable
private fun ManualTab(
    onClaim: suspend (host: String, port: Int, code: String, fp: String) -> String?,
    onDone: () -> Unit,
) {
    var host by remember { mutableStateOf("") }
    var portText by remember { mutableStateOf("3737") }
    var code by remember { mutableStateOf("") }
    var fp by remember { mutableStateOf("") }
    var claiming by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun claim() {
        val h = host.trim()
        if (h.isEmpty()) {
            error = "请输入 Mac 的 IP 地址或主机名"
            return
        }
        if (!code.trim().matches(Regex("^\\d{6}$"))) {
            error = "配对码是 6 位数字 — 在 Mac 菜单栏点「配对」重新生成"
            return
        }
        val normalizedFp = FingerprintPin.normalize(fp)
        if (normalizedFp == null) {
            error = "指纹是 64 位十六进制字符 — Mac 菜单栏配对面板或 quota-watch connect 输出里有"
            return
        }
        val p = portText.trim().toIntOrNull() ?: 3737
        claiming = true
        error = null
        scope.launch {
            val msg = onClaim(h, p, code.trim(), normalizedFp)
            claiming = false
            if (msg == null) onDone() else error = msg
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
        Text("在 Mac 菜单栏的 quota-watch 采集器中打开「配对」，输入显示的信息。",
            fontSize = 13.sp, color = QWColors.Muted, lineHeight = 19.sp)
        Spacer(Modifier.height(16.dp))
        PairField("主机", host, { host = it }, hint = "192.168.x.x",
            keyboard = KeyboardType.Ascii)
        PairField("端口", portText, { portText = it }, hint = "3737",
            keyboard = KeyboardType.Number)
        PairField("配对码", code, { code = it }, hint = "6 位数字",
            keyboard = KeyboardType.NumberPassword)
        PairField("证书指纹", fp, { fp = it }, hint = "64 位十六进制",
            keyboard = KeyboardType.Ascii)
        error?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, fontSize = 13.sp, color = QWColors.Danger)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = ::claim,
            enabled = !claiming,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = QWColors.Accent, contentColor = QWColors.AccentInk),
        ) {
            if (claiming) {
                CircularProgressIndicator(Modifier.size(16.dp),
                    color = QWColors.AccentInk, strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
            }
            Text(if (claiming) "正在连接…" else "连接到 Mac", fontSize = 17.sp)
        }
        Spacer(Modifier.height(12.dp))
        Text("连接成功后会自动写入主机、端口与 token；之后可在设置中检查和更新。",
            fontSize = 12.sp, color = QWColors.Subtle, lineHeight = 18.sp)
    }
}

@Composable
private fun PairField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    keyboard: KeyboardType,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, fontSize = 13.sp, color = QWColors.Subtle)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, color = QWColors.Subtle) },
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(
                fontFamily = JetBrainsMonoFamily, fontSize = 15.sp,
                color = QWColors.Foreground,
            ),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = QWColors.Accent,
                unfocusedBorderColor = QWColors.Border,
                cursorColor = QWColors.Accent,
            ),
        )
    }
}
