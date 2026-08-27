package io.quotawatch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.ui.theme.FrauncesFamily
import io.quotawatch.ui.theme.QWColors

/** 首次启动 / 未配对 —— 先解释本地优先，再给唯一主操作（port of WelcomeView）。 */
@Composable
fun WelcomeScreen(
    onScanPairing: () -> Unit,
    onManualPairing: () -> Unit,
    onDemo: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(52.dp))

        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = QWColors.Foreground)) { append("quota") }
                withStyle(SpanStyle(color = QWColors.Accent)) { append("—") }
                withStyle(SpanStyle(color = QWColors.Foreground)) { append("watch") }
            },
            fontFamily = FrauncesFamily,
            fontSize = 42.sp,
        )

        Text(
            "把 Mac 上的配额，带到随手可看的地方。采集器只在你的 Mac 上读取本地订阅状态；手机只接收你主动配对的摘要。",
            color = QWColors.Muted,
            fontSize = 15.sp,
            lineHeight = 24.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 18.dp, bottom = 42.dp).padding(horizontal = 4.dp),
        )

        Button(
            onClick = onScanPairing,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = QWColors.Accent,
                contentColor = QWColors.AccentInk,
            ),
        ) {
            Text("扫描 Mac 上的配对码", fontSize = 17.sp)
        }

        OutlinedButton(
            onClick = onManualPairing,
            modifier = Modifier.fillMaxWidth().height(46.dp).padding(top = 0.dp),
            shape = RoundedCornerShape(14.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, QWColors.Border),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = QWColors.Foreground),
        ) {
            Text("改用 6 位配对码", fontSize = 15.sp)
        }

        Text(
            "配对后约每 10 秒刷新。离线时继续显示最近一次缓存，不上传账号凭据。",
            color = QWColors.Subtle,
            fontSize = 12.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 18.dp).padding(horizontal = 8.dp),
        )

        TextButton(onClick = onDemo, modifier = Modifier.padding(top = 8.dp)) {
            Text("先看示例数据", color = QWColors.Subtle, fontSize = 13.sp)
        }

        Spacer(Modifier.height(40.dp))
    }
}
