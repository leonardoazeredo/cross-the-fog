package codes.madera.crossfog.watch

import android.security.NetworkSecurityPolicy
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The installed app refuses plain HTTP to any host, the download hosts among them; the manifest text alone would
 * not show it.
 */
@RunWith(AndroidJUnit4::class)
class CleartextPolicyTest {
    @Test
    fun theInstalledAppPermitsNoCleartextTraffic() {
        val policy = NetworkSecurityPolicy.getInstance()
        assertFalse(policy.isCleartextTrafficPermitted)
        listOf("download.mapsforge.org", "s3.amazonaws.com", "ftp.gwdg.de").forEach { host ->
            assertFalse(host, policy.isCleartextTrafficPermitted(host))
        }
    }
}
