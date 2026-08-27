package io.quotawatch.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color

/**
 * "Anthropic-style v2" dark palette — port of iOS Theme.swift dark variants.
 * The app is dark-only; dynamic color is never used. Brand colors never carry
 * quota semantics (UsageLevel owns those).
 */
object QWColors {
    val Background = Color(0xFF100C09)
    val Surface = Color(0xFF1A1510)
    val Surface2 = Color(0xFF231E19)
    val Foreground = Color(0xFFE8E4DD)
    val Muted = Color(0xFF9C9890)
    val Subtle = Color(0xFF908B86)
    val Border = Color(0xFF2F2B26)
    val Accent = Color(0xFFD8916D)
    val AccentInk = Color(0xFF16100B)
    val Success = Color(0xFF66A770)
    val Warning = Color(0xFFE0AE63)
    val WarningInk = Color(0xFFEBC48C)
    val Danger = Color(0xFFE17366)

    // Per-provider brand (icon + status dot only)
    val Claude = Color(0xFFD9723D)
    val Codex = Color(0xFF3D8A56)
    val GLM = Color(0xFF5284B7)
    val Kimi = Color(0xFF8572A9)
    val OpenCode = Color(0xFFAA813C)
    val Antigravity = Color(0xFFA66183)
}

val QWDarkColorScheme = darkColorScheme(
    primary = QWColors.Accent,
    onPrimary = QWColors.AccentInk,
    background = QWColors.Background,
    onBackground = QWColors.Foreground,
    surface = QWColors.Surface,
    onSurface = QWColors.Foreground,
    surfaceVariant = QWColors.Surface2,
    onSurfaceVariant = QWColors.Muted,
    outline = QWColors.Border,
    error = QWColors.Danger,
)

/** Layout tokens (iOS spacing/radius). */
object QWDimens {
    const val SpaceXs = 4
    const val SpaceSm = 8
    const val SpaceMd = 12
    const val SpaceLg = 16
    const val SpaceXl = 24
    const val SpaceXxl = 32
    const val RadiusControl = 10
    const val RadiusSheet = 16
    const val PagePadding = 24
    const val StaleOpacity = 0.62f
}
