package io.quotawatch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import io.quotawatch.ui.QWNavHost
import io.quotawatch.ui.theme.QWDarkColorScheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = QWDarkColorScheme) {
                QWNavHost()
            }
        }
    }
}
