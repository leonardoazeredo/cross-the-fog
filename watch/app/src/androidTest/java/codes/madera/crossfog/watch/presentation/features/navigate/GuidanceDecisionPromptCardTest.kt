package codes.madera.crossfog.watch.presentation.features.navigate

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import codes.madera.crossfog.watch.presentation.design.theme.GlanceMapTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GuidanceDecisionPromptCardTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun withNoAcceptTextOnlyTheDismissButtonShowsAndItDismisses() {
        var dismissed = 0
        composeRule.setContent {
            GlanceMapTheme {
                GuidanceDecisionPromptCard(
                    title = "Off route",
                    detail = "45 m from GPX",
                    acceptText = null,
                    dismissText = "Ignore",
                    onDismiss = { dismissed++ },
                )
            }
        }
        composeRule.onNodeWithText("Off route").assertIsDisplayed()
        composeRule.onNodeWithText("45 m from GPX").assertIsDisplayed()
        composeRule.onNodeWithText("Guide").assertDoesNotExist()
        composeRule.onNodeWithText("Ignore").performClick()
        composeRule.runOnIdle { assertEquals(1, dismissed) }
    }

    @Test
    fun withAcceptTextBothButtonsShowAndAcceptRuns() {
        var accepted = 0
        composeRule.setContent {
            GlanceMapTheme {
                GuidanceDecisionPromptCard(
                    title = "Route complete",
                    detail = "",
                    acceptText = "Reverse",
                    dismissText = "Close",
                    onAccept = { accepted++ },
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithText("Close").assertIsDisplayed()
        composeRule.onNodeWithText("Reverse").performClick()
        composeRule.runOnIdle { assertEquals(1, accepted) }
    }
}
