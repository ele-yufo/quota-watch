package io.quotawatch.ui.theme

import androidx.annotation.DrawableRes
import androidx.compose.ui.graphics.Color
import io.quotawatch.R

/** providerType → (brand color, glyph) — port of ProviderStyle.swift.
 *  Brand colors never carry quota semantics. */
data class ProviderStyle(val color: Color, @DrawableRes val icon: Int)

object ProviderStyles {
    fun of(providerType: String): ProviderStyle = when (providerType) {
        "claude" -> ProviderStyle(QWColors.Claude, R.drawable.ic_brand_claude)
        "codex" -> ProviderStyle(QWColors.Codex, R.drawable.ic_brand_codex)
        "glm-cn" -> ProviderStyle(QWColors.GLM, R.drawable.ic_brand_glm)
        "opencode-go" -> ProviderStyle(QWColors.OpenCode, R.drawable.ic_brand_opencode)
        "kimi" -> ProviderStyle(QWColors.Kimi, R.drawable.ic_brand_kimi)
        "antigravity" -> ProviderStyle(QWColors.Antigravity, R.drawable.ic_brand_antigravity)
        "copilot" -> ProviderStyle(QWColors.Muted, R.drawable.ic_brand_copilot)
        else -> ProviderStyle(QWColors.Muted, R.drawable.ic_brand_generic)
    }
}
