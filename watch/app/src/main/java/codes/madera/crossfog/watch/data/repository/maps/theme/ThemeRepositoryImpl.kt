package codes.madera.crossfog.watch.data.repository.maps.theme

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import codes.madera.crossfog.watch.R
import codes.madera.crossfog.watch.core.maps.theme.BundledRenderThemeAssetLocator
import codes.madera.crossfog.watch.domain.model.maps.theme.ThemeListItem
import codes.madera.crossfog.watch.domain.model.maps.theme.ThemeUiIds.DEFAULT_STYLE_ID
import codes.madera.crossfog.watch.domain.model.maps.theme.ThemeUiIds.HILL_SHADING
import codes.madera.crossfog.watch.domain.model.maps.theme.ThemeUiIds.NIGHT_MODE
import codes.madera.crossfog.watch.domain.model.maps.theme.ThemeUiIds.RELIEF_OVERLAY
import codes.madera.crossfog.watch.domain.model.maps.theme.mapsforge.MapsforgeThemeCatalog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext

class ThemeRepositoryImpl(
    private val context: Context,
    private val selectedMapPath: Flow<String?>,
    private val externalThemes: ExternalThemeStore,
) : ThemeRepository {
    companion object {
        const val THEME_ID_MAPSFORGE = MapsforgeThemeCatalog.MAPSFORGE_THEME_ID
        const val THEME_ID_OPENHIKING = MapsforgeThemeCatalog.OPENHIKING_THEME_ID
        const val THEME_ID_HIKING_3D = MapsforgeThemeCatalog.HIKING_3D_THEME_ID
        private const val TAG = "ThemeRepository"
        private const val KEY_PREFIX_SELECTED_STYLE = "selected_style_"
        private const val KEY_PREFIX_ENABLED_OVERLAYS = "enabled_overlays_for_theme_"
        private const val KEY_LEGACY_SELECTED_STYLE = "selected_style"
        private const val KEY_PREFIX_LEGACY_ENABLED_OVERLAYS = "enabled_overlays_for_style_"
    }

    private val prefs =
        MapThemePreferences(context.getSharedPreferences(MapThemePreferences.PREFERENCES_NAME, Context.MODE_PRIVATE))

    private val keySelectedThemeId = "selected_theme_id"

    /** Theme to restore when the 3D hiking theme shortcut is switched off. */
    private val keyThemeBeforeHiking3d = "theme_before_hiking_3d"
    private val keyHillShadingEnabled = "global_hill_shading_enabled"
    private val keyReliefOverlayEnabled = "global_relief_overlay_enabled"
    private val keyNightModeEnabled = "global_night_mode_enabled"
    private val keyLegacySlopeOverlayEnabled = "global_slope_overlay_enabled"
    private val parsedByTheme: Map<String, ParsedStyleMenu> by lazy {
        buildMap {
            if (BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, THEME_ID_OPENHIKING)) {
                put(
                    THEME_ID_OPENHIKING,
                    parseThemeStyleMenuFromXml(context, THEME_ID_OPENHIKING, TAG),
                )
            }
            // Parsed (no style menu) so settings do not fall back to OpenHiking's styles for it.
            if (BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, THEME_ID_HIKING_3D)) {
                put(
                    THEME_ID_HIKING_3D,
                    parseThemeStyleMenuFromXml(context, THEME_ID_HIKING_3D, TAG),
                )
            }
        }
    }

    private val nativeHillShadingSupportByBundledTheme: Map<String, Boolean> by lazy {
        buildMap {
            bundledThemeIds().forEach { themeId ->
                if (BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, themeId)) {
                    put(themeId, bundledThemeSupportsNativeHillShading(context, themeId, TAG))
                }
            }
        }
    }

    override fun getThemeItems(): Flow<List<ThemeListItem>> = observe { getCurrentThemeState() }

    override fun getThemeSelection(): Flow<ThemeSelection> = observe { getCurrentSelection() }

    private fun preferenceChanges(): Flow<Unit> =
        callbackFlow {
            val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> trySend(Unit) }
            prefs.registerOnSharedPreferenceChangeListener(listener)
            trySend(Unit)
            awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
        }

    private fun <T> observe(read: () -> T): Flow<T> =
        combine(selectedMapPath, preferenceChanges(), externalThemes.changes) { path, _, _ ->
            synchronized(prefs) {
                val changedMap = prefs.mapPath != path
                prefs.mapPath = path
                if (changedMap) Log.i(TAG, "per_map_association_applied theme=${selectedThemeIdOrDefault()}")
                read()
            }
        }.flowOn(Dispatchers.IO)

    private suspend fun withMapPreferences(action: () -> Unit) {
        val path = selectedMapPath.first()
        withContext(Dispatchers.IO) {
            synchronized(prefs) {
                prefs.mapPath = path
                action()
            }
        }
    }

    override suspend fun deleteExternalPackage(packageId: String) {
        withContext(Dispatchers.IO) {
            try {
                externalThemes.deletePackage(packageId)
            } finally {
                synchronized(prefs) { prefs.invalidateExternalThemes(externalThemes.themes().map { it.id }.toSet()) }
            }
        }
    }

    override suspend fun onExternalRenderFailure(themeId: String) {
        Log.w(TAG, "external_theme_render_failure theme=$themeId; fallback_to_built_in")
        withContext(Dispatchers.IO) {
            synchronized(prefs) {
                prefs.invalidateExternalThemes(
                    externalThemes
                        .themes()
                        .map { it.id }
                        .filterNot { it == themeId }
                        .toSet(),
                )
            }
        }
    }

    private fun selectedStyleKeyForTheme(themeId: String): String = "$KEY_PREFIX_SELECTED_STYLE$themeId"

    private fun bundledThemeIds(): List<String> = listOf(THEME_ID_OPENHIKING, THEME_ID_HIKING_3D)

    /** [stored] when it names a kept bundled theme whose asset is present, else the default, as a selectable theme id. */
    private fun bundledChoiceOrDefault(stored: String?): String {
        val id =
            MapsforgeThemeCatalog.bundledThemeOrDefault(stored) {
                BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, it)
            }
        // The default is Classic when OpenHiking's asset is missing; that is a Mapsforge style, not a bundled theme.
        return if (MapsforgeThemeCatalog.isMapsforgeStyleId(id)) migrateLegacyMapsforgeSelection(id) else id
    }

    private fun themeSupportsNativeHillShading(themeId: String?): Boolean {
        val normalizedThemeId = themeId?.trim()?.takeIf { it.isNotEmpty() } ?: return false
        return when {
            normalizedThemeId.startsWith("external:") -> true
            MapsforgeThemeCatalog.isMapsforgeFamilyTheme(normalizedThemeId) -> true
            MapsforgeThemeCatalog.isMapsforgeStyleId(normalizedThemeId) -> true
            MapsforgeThemeCatalog.isBundledAssetTheme(normalizedThemeId) -> {
                nativeHillShadingSupportByBundledTheme[normalizedThemeId] == true
            }
            else -> false
        }
    }

    private fun enabledOverlaysKeyFor(
        themeId: String,
        styleId: String,
    ): String = "${KEY_PREFIX_ENABLED_OVERLAYS}${themeId}_style_$styleId"

    private fun legacyEnabledOverlaysKeyFor(styleId: String): String = "$KEY_PREFIX_LEGACY_ENABLED_OVERLAYS$styleId"

    private fun parsedForTheme(themeId: String): ParsedStyleMenu {
        if (themeId.startsWith("external:") || MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId)) {
            return ParsedStyleMenu(
                defaultStyleId = null,
                styles = emptyList(),
                overlayDefinitions = emptyMap(),
            )
        }
        return parsedByTheme[themeId] ?: parsedByTheme[THEME_ID_OPENHIKING] ?: ParsedStyleMenu(
            defaultStyleId = null,
            styles = emptyList(),
            overlayDefinitions = emptyMap(),
        )
    }

    private fun mapsforgeStyleIdOrDefault(): String {
        val storedStyleId =
            prefs
                .getString(selectedStyleKeyForTheme(THEME_ID_MAPSFORGE), null)
                ?.trim()
                .orEmpty()
        return MapsforgeThemeCatalog.optionById(storedStyleId)?.id
            ?: MapsforgeThemeCatalog.defaultOption().id
    }

    private fun migrateLegacyMapsforgeSelection(styleId: String): String {
        val resolvedStyleId =
            MapsforgeThemeCatalog.optionById(styleId)?.id
                ?: MapsforgeThemeCatalog.defaultOption().id
        prefs.editLegacyChoice().apply {
            putString(keySelectedThemeId, THEME_ID_MAPSFORGE)
            putString(selectedStyleKeyForTheme(THEME_ID_MAPSFORGE), resolvedStyleId)
            apply()
        }
        return THEME_ID_MAPSFORGE
    }

    override suspend fun setTheme(themeId: String) = withMapPreferences { applyTheme(themeId) }

    override suspend fun setHiking3dThemeEnabled(enabled: Boolean) =
        withMapPreferences {
            val transition =
                hiking3dThemeTransition(
                    currentThemeId = selectedThemeIdOrDefault(),
                    // A theme removed since the shortcut was switched on cannot be restored.
                    themeBeforeHiking3d =
                        prefs.getString(keyThemeBeforeHiking3d, null)
                            ?.takeUnless(MapsforgeThemeCatalog::isRemovedBundledTheme),
                    enable = enabled,
                    fallbackThemeId = bundledChoiceOrDefault(null),
                )
            transition.themeToSelect?.let(::applyTheme)
            prefs.edit().apply {
                if (transition.themeToRemember == null) {
                    remove(keyThemeBeforeHiking3d)
                } else {
                    putString(keyThemeBeforeHiking3d, transition.themeToRemember)
                }
                apply()
            }
        }

    private fun applyTheme(themeId: String) {
        Log.i(TAG, "theme_selected theme=$themeId")
        val validThemeId =
            when {
                externalThemes.themes().any { it.id == themeId } -> themeId
                MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId) -> themeId
                else ->
                    MapsforgeThemeCatalog.bundledThemeOrDefault(themeId) {
                        BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, it)
                    }
            }
        prefs.edit().apply {
            putString(keySelectedThemeId, validThemeId)
            if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(validThemeId)) {
                putString(selectedStyleKeyForTheme(validThemeId), mapsforgeStyleIdOrDefault())
            }
            apply()
        }
    }

    override suspend fun setMapStyle(styleId: String) =
        withMapPreferences {
            val selectedThemeId = selectedThemeIdOrDefault()
            if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(selectedThemeId)) {
                setMapsforgeStyle(styleId)
                return@withMapPreferences
            }
            if (!MapsforgeThemeCatalog.isBundledAssetTheme(selectedThemeId)) return@withMapPreferences

            setStandardBundledStyle(selectedThemeId, styleId)
        }

    private fun setMapsforgeStyle(styleId: String) {
        val resolvedStyleId =
            MapsforgeThemeCatalog.optionById(styleId)?.id
                ?: MapsforgeThemeCatalog.defaultOption().id
        prefs.edit().apply {
            putString(keySelectedThemeId, THEME_ID_MAPSFORGE)
            putString(selectedStyleKeyForTheme(THEME_ID_MAPSFORGE), resolvedStyleId)
            apply()
        }
    }

    private fun setStandardBundledStyle(
        selectedThemeId: String,
        styleId: String,
    ) {
        val parsed = parsedForTheme(selectedThemeId)
        val effectiveStyleId =
            when {
                styleId == DEFAULT_STYLE_ID -> DEFAULT_STYLE_ID
                isStyleAllowedForTheme(selectedThemeId, styleId, parsed) -> styleId
                else -> DEFAULT_STYLE_ID
            }
        prefs
            .edit()
            .putString(selectedStyleKeyForTheme(selectedThemeId), effectiveStyleId)
            .apply()
    }

    override suspend fun toggleOverlay(
        styleId: String,
        overlayId: String,
    ) = withMapPreferences {
        val selectedThemeId = selectedThemeIdOrDefault()
        if (!MapsforgeThemeCatalog.isBundledAssetTheme(selectedThemeId)) return@withMapPreferences
        val parsed = parsedForTheme(selectedThemeId)
        val requestedStyleId = styleId

        val effectiveStyleId =
            resolveEffectiveStyleId(requestedStyleId, selectedThemeId, parsed) ?: return@withMapPreferences
        val style = parsed.stylesById[effectiveStyleId] ?: return@withMapPreferences
        if (overlayId !in style.overlayLayerIds) return@withMapPreferences

        val key = enabledOverlaysKeyFor(selectedThemeId, style.id)
        val current =
            if (requestedStyleId == DEFAULT_STYLE_ID) {
                // "Default" must remain pristine even if explicit default style has custom overlays.
                getDefaultEnabledOverlays(style, parsed).toMutableSet()
            } else {
                readEnabledOverlaysForStyle(selectedThemeId, style, parsed).toMutableSet()
            }

        if (current.contains(overlayId)) current.remove(overlayId) else current.add(overlayId)

        prefs.edit().apply {
            // If user tweaks overlays while "Default" is selected, promote to explicit style.
            if (requestedStyleId == DEFAULT_STYLE_ID) {
                putString(selectedStyleKeyForTheme(selectedThemeId), style.id)
            }
            putStringSet(key, current)
            apply()
        }
    }

    override suspend fun setOverlaysForStyle(
        styleId: String,
        enabledOverlayLayerIds: Set<String>,
    ) = withMapPreferences {
        val selectedThemeId = selectedThemeIdOrDefault()
        if (!MapsforgeThemeCatalog.isBundledAssetTheme(selectedThemeId)) return@withMapPreferences
        val parsed = parsedForTheme(selectedThemeId)
        val requestedStyleId = styleId

        val effectiveStyleId =
            resolveEffectiveStyleId(requestedStyleId, selectedThemeId, parsed) ?: return@withMapPreferences
        val style = parsed.stylesById[effectiveStyleId] ?: return@withMapPreferences

        val allowed = style.overlayLayerIds.toSet()
        val sanitized =
            enabledOverlayLayerIds
                .asSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() && it in allowed }
                .toSet()

        val key = enabledOverlaysKeyFor(selectedThemeId, style.id)
        val defaults = getDefaultEnabledOverlays(style, parsed)

        prefs.edit().apply {
            if (requestedStyleId == DEFAULT_STYLE_ID) {
                if (sanitized == defaults) {
                    putString(selectedStyleKeyForTheme(selectedThemeId), DEFAULT_STYLE_ID)
                    remove(key)
                } else {
                    putString(selectedStyleKeyForTheme(selectedThemeId), style.id)
                    putStringSet(key, sanitized)
                }
            } else {
                putStringSet(key, sanitized)
            }
            apply()
        }
    }

    override suspend fun setHillShadingEnabled(enabled: Boolean) =
        withMapPreferences {
            prefs.edit().putBoolean(keyHillShadingEnabled, enabled).apply()
        }

    override suspend fun setReliefOverlayEnabled(enabled: Boolean) =
        withMapPreferences {
            prefs
                .edit()
                .putBoolean(keyReliefOverlayEnabled, enabled)
                .remove(keyLegacySlopeOverlayEnabled)
                .apply()
        }

    override suspend fun setNightModeEnabled(enabled: Boolean) =
        withMapPreferences {
            prefs.edit().putBoolean(keyNightModeEnabled, enabled).apply()
        }

    override suspend fun resetToDefaults() =
        withMapPreferences {
            val editor =
                prefs
                    .edit()
                    .remove(keySelectedThemeId)
                    .remove(KEY_LEGACY_SELECTED_STYLE)
                    .remove(keyHillShadingEnabled)
                    .remove(keyReliefOverlayEnabled)
                    .remove(keyNightModeEnabled)
                    .remove(keyLegacySlopeOverlayEnabled)
            parsedByTheme.forEach { (themeId, parsed) ->
                editor.remove(selectedStyleKeyForTheme(themeId))
                parsed.styles.forEach { style ->
                    editor.remove(enabledOverlaysKeyFor(themeId, style.id))
                    editor.remove(legacyEnabledOverlaysKeyFor(style.id))
                }
            }
            prefs.all.keys
                .asSequence()
                .filter { it.startsWith(KEY_PREFIX_SELECTED_STYLE) || it.startsWith(KEY_PREFIX_ENABLED_OVERLAYS) }
                .forEach { editor.remove(it) }
            prefs.all.keys
                .asSequence()
                .filter { it.startsWith(KEY_PREFIX_LEGACY_ENABLED_OVERLAYS) }
                .forEach { editor.remove(it) }
            editor.apply()
        }

    private fun getDefaultEnabledOverlays(
        style: StyleDefinition,
        parsed: ParsedStyleMenu,
    ): Set<String> =
        style.overlayLayerIds
            .asSequence()
            .filter { layerId -> parsed.overlayDefinitions[layerId]?.enabledByDefault == true }
            .toSet()

    private fun readEnabledOverlaysForStyle(
        themeId: String,
        style: StyleDefinition,
        parsed: ParsedStyleMenu,
    ): Set<String> {
        val defaultEnabled = getDefaultEnabledOverlays(style, parsed)
        val allowed = style.overlayLayerIds.toSet()
        val key = enabledOverlaysKeyFor(themeId, style.id)
        val storedRaw =
            prefs.getStringSet(key, null)
        val stored =
            storedRaw
                ?.asSequence()
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                ?.toSet()
                ?: return defaultEnabled

        val valid = stored.filterTo(mutableSetOf()) { it in allowed }
        if (valid.isEmpty() && stored.isNotEmpty()) {
            // Legacy prefs may contain old group ids. Fall back to style defaults.
            return defaultEnabled
        }
        return valid
    }

    private fun selectedThemeIdOrDefault(): String {
        val selected = prefs.getString(keySelectedThemeId, null)?.trim().orEmpty()
        if (selected == MapsforgeThemeCatalog.LEGACY_HILLSHADING_THEME_ID) {
            // Legacy choice removed from UI: keep user in Mapsforge family on the default style.
            return migrateLegacyMapsforgeSelection(MapsforgeThemeCatalog.defaultOption().id)
        }
        if (MapsforgeThemeCatalog.isMapsforgeStyleId(selected)) {
            return migrateLegacyMapsforgeSelection(selected)
        }
        if (selected.startsWith("external:")) {
            if (externalThemes.themes().any { it.id == selected }) return selected
            Log.w(TAG, "fallback_to_built_in theme=$selected")
            prefs.invalidateExternalThemes(externalThemes.themes().map { it.id }.toSet())
            return selectedThemeIdOrDefault()
        }
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(selected)) return THEME_ID_MAPSFORGE
        // Also where a choice of a removed bundled theme ends up (see MapsforgeThemeCatalog.isRemovedBundledTheme).
        return bundledChoiceOrDefault(selected)
    }

    private fun selectedStyleIdOrDefault(
        themeId: String,
        parsed: ParsedStyleMenu,
    ): String {
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId)) {
            return mapsforgeStyleIdOrDefault()
        }
        val storedSelectedStyle = prefs.getString(selectedStyleKeyForTheme(themeId), null)
        val selectedStyleId = (storedSelectedStyle ?: DEFAULT_STYLE_ID).trim()
        if (selectedStyleId == DEFAULT_STYLE_ID) return DEFAULT_STYLE_ID
        return if (isStyleAllowedForTheme(themeId, selectedStyleId, parsed)) selectedStyleId else DEFAULT_STYLE_ID
    }

    private fun hillShadingEnabledOrDefault(): Boolean = prefs.getBoolean(keyHillShadingEnabled, false)

    private fun nightModeEnabledOrDefault(): Boolean = prefs.getBoolean(keyNightModeEnabled, false)

    private fun reliefOverlayEnabledOrDefault(): Boolean =
        when {
            prefs.contains(keyReliefOverlayEnabled) -> prefs.getBoolean(keyReliefOverlayEnabled, false)
            prefs.contains(keyLegacySlopeOverlayEnabled) -> prefs.getBoolean(keyLegacySlopeOverlayEnabled, false)
            else -> false
        }

    private fun resolveDefaultStyleId(
        themeId: String,
        parsed: ParsedStyleMenu,
    ): String? {
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId)) {
            return MapsforgeThemeCatalog.defaultOption().id
        }
        val fromMenu = parsed.defaultStyleId
        if (fromMenu != null && isStyleAllowedForTheme(themeId, fromMenu, parsed)) return fromMenu
        return parsed.styles.firstOrNull()?.id
    }

    private fun resolveEffectiveStyleId(
        selectedStyleId: String,
        themeId: String,
        parsed: ParsedStyleMenu,
    ): String? =
        if (selectedStyleId == DEFAULT_STYLE_ID) {
            resolveDefaultStyleId(themeId, parsed)
        } else {
            if (isStyleAllowedForTheme(themeId, selectedStyleId, parsed)) {
                selectedStyleId
            } else {
                resolveDefaultStyleId(themeId, parsed)
            }
        }

    private fun getCurrentSelection(): ThemeSelection {
        val selectedThemeId = selectedThemeIdOrDefault()
        val nightModeEnabled = nightModeEnabledOrDefault()
        val hillShadingPreferenceEnabled = hillShadingEnabledOrDefault()
        val renderingThemeId = if (nightModeEnabled) THEME_ID_MAPSFORGE else selectedThemeId
        val hillShadingEnabled =
            hillShadingPreferenceEnabled &&
                themeSupportsNativeHillShading(renderingThemeId)
        val reliefOverlayEnabled = reliefOverlayEnabledOrDefault()
        if (nightModeEnabled) {
            val darkOption =
                MapsforgeThemeCatalog.optionById(MapsforgeThemeCatalog.DARK_MAPSFORGE_STYLE_ID)
                    ?: MapsforgeThemeCatalog.defaultOption()
            return ThemeSelection(
                themeId = THEME_ID_MAPSFORGE,
                mapsforgeThemeName = darkOption.themeName,
                styleId = darkOption.id,
                enabledOverlayLayerIds = emptyList(),
                hillShadingEnabled = hillShadingEnabled,
                reliefOverlayEnabled = reliefOverlayEnabled,
                nightModeEnabled = true,
            )
        }
        val external = externalThemes.themes().firstOrNull { it.id == selectedThemeId }
        if (external != null) {
            return ThemeSelection(
                themeId = external.id,
                mapsforgeThemeName = null,
                styleId = DEFAULT_STYLE_ID,
                enabledOverlayLayerIds = emptyList(),
                hillShadingEnabled = hillShadingEnabled,
                reliefOverlayEnabled = reliefOverlayEnabled,
                nightModeEnabled = false,
                source = external,
            )
        }
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(selectedThemeId)) {
            val selectedStyleId = mapsforgeStyleIdOrDefault()
            val mapsforgeOption =
                MapsforgeThemeCatalog.optionById(selectedStyleId)
                    ?: MapsforgeThemeCatalog.defaultOption()
            return ThemeSelection(
                themeId = selectedThemeId,
                mapsforgeThemeName = mapsforgeOption.themeName,
                styleId = selectedStyleId,
                enabledOverlayLayerIds = emptyList(),
                hillShadingEnabled = hillShadingEnabled,
                reliefOverlayEnabled = reliefOverlayEnabled,
                nightModeEnabled = nightModeEnabled,
            )
        }

        val parsed = parsedForTheme(selectedThemeId)
        val renderingStyleId = selectedStyleIdOrDefault(selectedThemeId, parsed)
        val effectiveStyleId =
            resolveEffectiveStyleId(renderingStyleId, selectedThemeId, parsed) ?: return ThemeSelection(
                themeId = selectedThemeId,
                mapsforgeThemeName = null,
                styleId = DEFAULT_STYLE_ID,
                enabledOverlayLayerIds = emptyList(),
                hillShadingEnabled = hillShadingEnabled,
                reliefOverlayEnabled = reliefOverlayEnabled,
                nightModeEnabled = nightModeEnabled,
            )
        val selectedStyle =
            parsed.stylesById[effectiveStyleId] ?: return ThemeSelection(
                themeId = selectedThemeId,
                mapsforgeThemeName = null,
                styleId = DEFAULT_STYLE_ID,
                enabledOverlayLayerIds = emptyList(),
                hillShadingEnabled = hillShadingEnabled,
                reliefOverlayEnabled = reliefOverlayEnabled,
                nightModeEnabled = nightModeEnabled,
            )
        val enabledLayerIds =
            if (renderingStyleId == DEFAULT_STYLE_ID) {
                getDefaultEnabledOverlays(selectedStyle, parsed).toList().sorted()
            } else {
                readEnabledOverlaysForStyle(selectedThemeId, selectedStyle, parsed).toList().sorted()
            }

        return ThemeSelection(
            themeId = selectedThemeId,
            mapsforgeThemeName = null,
            styleId = renderingStyleId,
            enabledOverlayLayerIds = enabledLayerIds,
            hillShadingEnabled = hillShadingEnabled,
            reliefOverlayEnabled = reliefOverlayEnabled,
            nightModeEnabled = nightModeEnabled,
        )
    }

    private fun getCurrentThemeState(): List<ThemeListItem> {
        val selectedThemeId = selectedThemeIdOrDefault()
        val selectedThemeIdUi = selectedThemeId
        val parsed = parsedForTheme(selectedThemeId)
        val selectedStyleId = selectedStyleIdOrDefault(selectedThemeId, parsed)
        val hillShadingEnabled = hillShadingEnabledOrDefault()
        val hillShadingSupported = themeSupportsNativeHillShading(selectedThemeId)
        val reliefOverlayEnabled = reliefOverlayEnabledOrDefault()
        val nightModeEnabled = nightModeEnabledOrDefault()
        val items = mutableListOf<ThemeListItem>()

        items += ThemeListItem.Header(context.getString(R.string.map_theme))
        items +=
            ThemeListItem.GlobalToggle(
                id = NIGHT_MODE,
                name = context.getString(R.string.settings_night_mode),
                enabled = nightModeEnabled,
            )
        if (BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, THEME_ID_OPENHIKING)) {
            items +=
                ThemeListItem.ThemeOption(
                    id = THEME_ID_OPENHIKING,
                    name = context.getString(R.string.map_openhiking),
                    selected = selectedThemeIdUi == THEME_ID_OPENHIKING,
                )
        }
        if (BundledRenderThemeAssetLocator.isThemeAvailable(context.assets, THEME_ID_HIKING_3D)) {
            items +=
                ThemeListItem.ThemeOption(
                    id = THEME_ID_HIKING_3D,
                    name = context.getString(R.string.map_terrain_3d_hiking_theme),
                    selected = selectedThemeIdUi == THEME_ID_HIKING_3D,
                )
        }
        items +=
            ThemeListItem.ThemeOption(
                id = THEME_ID_MAPSFORGE,
                name = context.getString(R.string.map_mapsforge),
                selected = selectedThemeIdUi == THEME_ID_MAPSFORGE,
            )
        externalThemes.themes().forEach { external ->
            val displayName = external.displayName.ifBlank { context.getString(R.string.map_imported_theme) }
            items +=
                ThemeListItem.ThemeOption(
                    id = external.id,
                    name = context.getString(R.string.map_custom, displayName),
                    selected = selectedThemeIdUi == external.id,
                    packageId = external.packageId,
                    packageDisplayName = displayName,
                )
        }
        items +=
            ThemeListItem.GlobalToggle(
                id = HILL_SHADING,
                name = context.getString(R.string.map_hill_shading_title),
                enabled = hillShadingEnabled,
                supported = hillShadingSupported,
            )
        items +=
            ThemeListItem.GlobalToggle(
                id = RELIEF_OVERLAY,
                name = context.getString(R.string.map_slope_overlay_title),
                enabled = reliefOverlayEnabled,
            )

        if (!themeSupportsStyleSelection(selectedThemeId, parsed)) {
            return items
        }

        items += ThemeListItem.Header(context.getString(R.string.map_theme_style))
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(selectedThemeId)) {
            items +=
                MapsforgeThemeCatalog.options.map { option ->
                    ThemeListItem.Style(
                        id = option.id,
                        name = option.label,
                        selected = option.id == selectedStyleId,
                    )
                }
        } else {
            val allowedStyles = parsed.styles
            val defaultStyleName =
                resolveDefaultStyleId(selectedThemeId, parsed)
                    ?.let { parsed.stylesById[it]?.name }
                    ?: context.getString(R.string.map_openhiking)
            val defaultStyleLabel = context.getString(R.string.map_default_2, defaultStyleName)

            items +=
                ThemeListItem.Style(
                    id = DEFAULT_STYLE_ID,
                    name = defaultStyleLabel,
                    selected = selectedStyleId == DEFAULT_STYLE_ID,
                )
            items +=
                allowedStyles.map { style ->
                    ThemeListItem.Style(
                        id = style.id,
                        name = style.name,
                        selected = style.id == selectedStyleId,
                    )
                }
        }

        if (!MapsforgeThemeCatalog.isBundledAssetTheme(selectedThemeId)) {
            return items
        }

        val selectedStyleIdForOverlay = selectedStyleId
        val effectiveStyleId = resolveEffectiveStyleId(selectedStyleIdForOverlay, selectedThemeId, parsed)
        val selectedStyle = effectiveStyleId?.let { parsed.stylesById[it] }
        if (selectedStyle != null && selectedStyle.overlayLayerIds.isNotEmpty()) {
            items += ThemeListItem.Header(context.getString(R.string.map_enabled_overlays))
            val enabledLayerIds =
                if (selectedStyleIdForOverlay == DEFAULT_STYLE_ID) {
                    getDefaultEnabledOverlays(selectedStyle, parsed)
                } else {
                    readEnabledOverlaysForStyle(selectedThemeId, selectedStyle, parsed)
                }
            val overlays =
                selectedStyle.overlayLayerIds.map { layerId ->
                    ThemeListItem.Overlay(
                        layerId = layerId,
                        name = parsed.overlayDefinitions[layerId]?.name ?: layerId,
                        enabled = layerId in enabledLayerIds,
                        defaultEnabled = parsed.overlayDefinitions[layerId]?.enabledByDefault == true,
                    )
                }
            items += overlays
        }

        return items
    }

    private fun themeSupportsStyleSelection(
        themeId: String,
        parsed: ParsedStyleMenu,
    ): Boolean =
        when {
            MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId) -> MapsforgeThemeCatalog.options.isNotEmpty()
            else -> parsed.styles.isNotEmpty()
        }

    private fun isStyleAllowedForTheme(
        themeId: String,
        styleId: String,
        parsed: ParsedStyleMenu,
    ): Boolean {
        if (MapsforgeThemeCatalog.isMapsforgeFamilyTheme(themeId)) {
            return MapsforgeThemeCatalog.optionById(styleId) != null
        }
        return parsed.stylesById.containsKey(styleId)
    }
}
