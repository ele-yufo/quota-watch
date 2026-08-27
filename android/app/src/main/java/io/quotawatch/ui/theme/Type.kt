package io.quotawatch.ui.theme

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import io.quotawatch.R

/** Fraunces variable — display/wordmark/key percentages ("qwDisplay").
 *  Used at weight ~550 like the iOS medium cut. */
@OptIn(ExperimentalTextApi::class)
val FrauncesFamily = FontFamily(
    Font(
        R.font.fraunces,
        weight = FontWeight.Medium,
        variationSettings = FontVariation.Settings(
            FontVariation.weight(550),
        ),
    ),
)

/** JetBrains Mono — numbers, countdowns, connection identifiers ("qwMono"). */
val JetBrainsMonoFamily = FontFamily(
    Font(R.font.jetbrains_mono_regular, weight = FontWeight.Normal),
    Font(R.font.jetbrains_mono_medium, weight = FontWeight.Medium),
    Font(R.font.jetbrains_mono_bold, weight = FontWeight.Bold),
    Font(R.font.jetbrains_mono_extrabold, weight = FontWeight.ExtraBold),
)
