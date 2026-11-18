package codes.madera.crossfog.watch.presentation.features.poi

import codes.madera.crossfog.watch.data.repository.SyntheticTopGroup
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PoiCategoryLabelsTest {
    @Test
    fun `every app-owned synthetic heading has a resource while imported labels pass through`() {
        SyntheticTopGroup.entries.forEach { group ->
            assertNotNull(group.label, poiCategoryNameRes(group.label))
        }
        assertNull(poiCategoryNameRes("User-supplied refuge category"))
    }
}
