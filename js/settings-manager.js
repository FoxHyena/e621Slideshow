import { state } from './state.js';
import { elements } from './dom-elements.js';
import Logger from './logger.js';
import { DEFAULT_BATCH_SIZE } from './constants.js';
import { pause, unPause } from './helpers.js';
import { invalidateQueryStringCache, validateCredentials } from './api-client.js';
import { loadFavorites, getCachedFavorites, isFavoritesCacheValid } from './favorites-fetcher.js';
import { analyzeTagsFromFavorites, getRecommendationStats } from './tag-analyzer.js';
import { formatRelativeTime } from './time-utils.js';
export function openSettingsPanel() {
    state.settingsPanelOpen = true;
    elements.settingsPanel.style.display = 'flex';
    clearTimeout(state.hideTimeout); // Prevent hiding UI while settings panel is open
    pause();
    Logger.log("opening settings");
    // Open Search tab by default
    openSearchTab();
}

export function openSearchTab() {
    elements.globalsettingsPanel.style.display = "none";
    elements.presetSettingsPanel.style.display = "none";
    elements.creditsPanel.style.display = "none";
    elements.searchPanel.style.display = "flex";
    elements.globalSettingsButton.classList.remove("selected");
    elements.globalPresetsButton.classList.remove("selected");
    elements.creditsButton.classList.remove("selected");
    elements.searchButton.classList.add("selected");
    
    // Restore search fields from temporary search if active, otherwise set defaults or preserve current values
    const savedTemporarySearch = localStorage.getItem("temporarySearch");
    const savedTemporarySearchActive = localStorage.getItem("temporarySearchActive");
    
    if (savedTemporarySearchActive === "true" && savedTemporarySearch) {
        try {
            // Restore from localStorage temporary search (source of truth)
            const tempPreset = JSON.parse(savedTemporarySearch);
            document.getElementById("searchRefreshRate").value = tempPreset.refreshRate || "10";
            document.getElementById("searchTags").value = tempPreset.tags || "";
            document.getElementById("searchBlacklist").value = tempPreset.blacklist || "";
            document.getElementById("searchWhitelist").value = tempPreset.whitelist || "";
            document.getElementById("searchAdultContent").checked = tempPreset.adultcontent || false;
        } catch (error) {
            Logger.error("Error restoring temporary search from localStorage:", error);
            // If parsing fails, set defaults
            const searchRefreshRate = document.getElementById("searchRefreshRate");
            const searchAdultContent = document.getElementById("searchAdultContent");
            if (!searchRefreshRate.value || searchRefreshRate.value.trim() === "") {
                searchRefreshRate.value = "10";
            }
            searchAdultContent.checked = true;
        }
    } else {
        // No temporary search active - set defaults if fields are empty, otherwise preserve current values
        const searchRefreshRate = document.getElementById("searchRefreshRate");
        const searchAdultContent = document.getElementById("searchAdultContent");
        const searchTags = document.getElementById("searchTags");
        
        // Set default refresh rate if empty
        if (!searchRefreshRate.value || searchRefreshRate.value.trim() === "") {
            searchRefreshRate.value = "10";
        }
        
        // Set default adult content to checked if tags field is empty (indicating a fresh/new search)
        if (!searchTags.value || searchTags.value.trim() === "") {
            searchAdultContent.checked = true;
        }
        // Otherwise preserve the current checkbox state
    }
}

export function openPresetSettings() {
    elements.globalsettingsPanel.style.display = "none";
    elements.creditsPanel.style.display = "none";
    elements.searchPanel.style.display = "none";
    elements.presetSettingsPanel.style.display = "flex";
    elements.globalSettingsButton.classList.remove("selected");
    elements.creditsButton.classList.remove("selected");
    elements.searchButton.classList.remove("selected");
    elements.globalPresetsButton.classList.add("selected");
}

export function openCredits() {
    elements.globalsettingsPanel.style.display = "none";
    elements.presetSettingsPanel.style.display = "none";
    elements.searchPanel.style.display = "none";
    elements.creditsPanel.style.display = "flex";
    elements.globalSettingsButton.classList.remove("selected");
    elements.globalPresetsButton.classList.remove("selected");
    elements.searchButton.classList.remove("selected");
    elements.creditsButton.classList.add("selected");
}

export function closeSettingsPanel() {
    state.settingsPanelOpen = false;
    elements.settingsPanel.style.display = 'none';
    unPause();
    Logger.log("closing settings");
}

export function openGlobalSettings() {
    elements.presetSettingsPanel.style.display = "none";
    elements.creditsPanel.style.display = "none";
    elements.searchPanel.style.display = "none";
    elements.globalsettingsPanel.style.display = "flex";
    elements.globalPresetsButton.classList.remove("selected");
    elements.creditsButton.classList.remove("selected");
    elements.searchButton.classList.remove("selected");
    elements.globalSettingsButton.classList.add("selected");
    loadGlobalSettings();
}

export async function loadGlobalSettings() {
    let globalSettingsJSON = localStorage.getItem("globalSettings");

    if (globalSettingsJSON === null || globalSettingsJSON === undefined) {
        state.globalSettings = {
            "username": '',
            "apikey": '',
            "globaltags": state.config.global_tags.join(" "),
            "globalblacklist": state.config.global_blacklist.join(" "),
            "globalwhitelist": state.config.global_whitelist.join(" "),
            "batchSize": DEFAULT_BATCH_SIZE,
            "debug": state.config.debug,
        };
    } else {
        state.globalSettings = JSON.parse(globalSettingsJSON);
        // Set default batchSize for existing users who don't have it
        if (state.globalSettings.batchSize === undefined || state.globalSettings.batchSize === null) {
            state.globalSettings.batchSize = DEFAULT_BATCH_SIZE;
        }
        // Set default debug for existing users
        if (state.globalSettings.debug === undefined || state.globalSettings.debug === null) {
            state.globalSettings.debug = (state.config && state.config.debug) || false;
        }
    }
    elements.usernameInput.value = state.globalSettings.username;
    elements.apiKeyInput.value = state.globalSettings.apikey;
    document.getElementById("globaltags").value = state.globalSettings.globaltags;
    document.getElementById("globalblacklist").value = state.globalSettings.globalblacklist;
    document.getElementById("globalwhitelist").value = state.globalSettings.globalwhitelist;
    document.getElementById("batchSize").value = state.globalSettings.batchSize;
    document.getElementById("debugMode").checked = state.globalSettings.debug;

    // Validate credentials if they exist
    if (state.globalSettings.username && state.globalSettings.apikey) {
        Logger.log("Validating saved credentials...");
        const result = await validateCredentials(state.globalSettings.username, state.globalSettings.apikey);
        state.credentialsValid = result.valid;
        if (result.valid) {
            Logger.log("Credentials are valid");
        } else {
            Logger.log(`Credentials validation failed: ${result.error}`);
        }
    } else {
        state.credentialsValid = false;
    }

    // Update favorites status display
    updateFavoritesStatus();

    Logger.log("loaded global settings");
}

// Update the favorites status display
function updateFavoritesStatus() {
    if (!state.globalSettings || !state.globalSettings.username) {
        elements.favoritesStatus.textContent = 'Username required';
        elements.fetchFavoritesBtn.disabled = true;
        return;
    }
    
    if (!state.credentialsValid) {
        elements.favoritesStatus.textContent = 'Invalid credentials';
        elements.fetchFavoritesBtn.disabled = true;
        return;
    }
    
    elements.fetchFavoritesBtn.disabled = false;
    
    // Check if we have cached favorites
    if (isFavoritesCacheValid(state.globalSettings.username)) {
        const cache = getCachedFavorites();
        const lastFetched = formatRelativeTime(cache.favoritesLastFetched);
        const count = cache.favoritesPosts.length;
        elements.favoritesStatus.textContent = `${count} favorites cached (${lastFetched})`;
        elements.favoritesStatus.style.color = 'var(--e621-text-secondary)';
    } else {
        elements.favoritesStatus.textContent = 'Cache expired or not found';
        elements.favoritesStatus.style.color = 'var(--e621-text-secondary)';
    }
}

// Fetch and analyze favorites
async function fetchAndAnalyzeFavorites(forceRefresh = false) {
    if (!state.globalSettings || !state.globalSettings.username || !state.globalSettings.apikey) {
        alert('Please enter your e621 username and API key first.');
        return;
    }
    
    if (!state.credentialsValid) {
        alert('Please enter valid credentials first. Save settings to validate.');
        return;
    }
    
    if (state.fetchingFavorites) {
        Logger.log('[fetchAndAnalyzeFavorites] Already fetching favorites');
        return;
    }
    
    state.fetchingFavorites = true;
    elements.fetchFavoritesBtn.disabled = true;
    elements.favoritesStatus.textContent = 'Fetching favorites...';
    elements.favoritesStatus.style.color = 'var(--e621-text-primary)';
    
    try {
        // Progress callback
        const progressCallback = (progress) => {
            if (progress.complete) {
                elements.favoritesStatus.textContent = `Fetched ${progress.fetched} favorites. Analyzing...`;
            } else {
                elements.favoritesStatus.textContent = `Fetching favorites... (page ${progress.page}, ${progress.fetched} so far)`;
            }
        };
        
        // Fetch favorites
        Logger.log('[fetchAndAnalyzeFavorites] Starting fetch...');
        const favorites = await loadFavorites(
            state.globalSettings.username,
            state.globalSettings.apikey,
            progressCallback,
            forceRefresh
        );
        
        Logger.log(`[fetchAndAnalyzeFavorites] Fetched ${favorites.length} favorites`);
        
        if (favorites.length === 0) {
            elements.favoritesStatus.textContent = 'No favorites found';
            elements.favoritesStatus.style.color = '#ff6b6b';
            alert('No favorites found on your e621 account. Please favorite some posts first!');
            return;
        }
        
        if (favorites.length < 5) {
            elements.favoritesStatus.textContent = `Only ${favorites.length} favorites found (need at least 5)`;
            elements.favoritesStatus.style.color = '#ff6b6b';
            alert('You need at least 5 favorites to generate recommendations. Please favorite more posts on e621.net first!');
            return;
        }
        
        // Analyze tags
        elements.favoritesStatus.textContent = 'Analyzing tags...';
        Logger.log('[fetchAndAnalyzeFavorites] Analyzing tags...');
        await analyzeTagsFromFavorites(favorites);
        
        // Show success
        elements.favoritesStatus.textContent = `✓ ${favorites.length} favorites analyzed`;
        elements.favoritesStatus.style.color = '#51cf66';
        
        Logger.log('[fetchAndAnalyzeFavorites] Analysis complete');
        
        // Show stats in debug mode
        if (state.globalSettings.debug) {
            const stats = getRecommendationStats();
            Logger.log('[fetchAndAnalyzeFavorites] Recommendation stats:', stats);
        }
        
    } catch (error) {
        Logger.error('[fetchAndAnalyzeFavorites] Error:', error);
        elements.favoritesStatus.textContent = `Error: ${error.message}`;
        elements.favoritesStatus.style.color = '#ff6b6b';
        alert(`Failed to fetch favorites: ${error.message}`);
    } finally {
        state.fetchingFavorites = false;
        elements.fetchFavoritesBtn.disabled = false;
    }
}

export async function saveGlobalSettings() {
    let globaltagsValue = document.getElementById("globaltags").value;
    let globalblacklistValue = document.getElementById("globalblacklist").value;
    let globalwhitelistValue = document.getElementById("globalwhitelist").value;
    let batchSizeValue = parseInt(document.getElementById("batchSize").value) || DEFAULT_BATCH_SIZE;
    let debugModeValue = document.getElementById("debugMode").checked;

    // Check if batch size changed - if so, reset cache to avoid pagination issues
    const oldBatchSize = state.globalSettings ? (state.globalSettings.batchSize || DEFAULT_BATCH_SIZE) : DEFAULT_BATCH_SIZE;
    const batchSizeChanged = oldBatchSize !== batchSizeValue;

    // Check if credentials changed
    const credentialsChanged = 
        state.globalSettings.username !== elements.usernameInput.value ||
        state.globalSettings.apikey !== elements.apiKeyInput.value;

    let loadedglobalSettings = {
        "username": elements.usernameInput.value,
        "apikey": elements.apiKeyInput.value,
        "globaltags": globaltagsValue,
        "globalblacklist": globalblacklistValue,
        "globalwhitelist": globalwhitelistValue,
        "batchSize": batchSizeValue,
        "debug": debugModeValue,
    };

    state.globalSettings = loadedglobalSettings;
    let globalSettingsJson = JSON.stringify(state.globalSettings);

    localStorage.setItem("globalSettings", globalSettingsJson);
    
    // Clear temporary search state when global settings change
    state.temporarySearchActive = false;
    state.savedPresetSettings = null;
    localStorage.removeItem("temporarySearch");
    localStorage.removeItem("temporarySearchActive");

    // Invalidate query string cache since global settings changed
    invalidateQueryStringCache();

    // Reset cache if batch size changed to ensure consistent pagination
    if (batchSizeChanged) {
        Logger.log(`[saveGlobalSettings] Batch size changed from ${oldBatchSize} to ${batchSizeValue}, resetting cache`);
        state.currentPostBatch = [];
        state.currentBatchIndex = 0;
        state.currentBatchPage = 1;
        state.prefetchedBatch = [];
        state.prefetchedPage = null;
        state.prefetchPromise = null;
    }

    // Validate credentials if they changed
    if (credentialsChanged) {
        if (state.globalSettings.username && state.globalSettings.apikey) {
            Logger.log("Validating credentials...");
            const result = await validateCredentials(state.globalSettings.username, state.globalSettings.apikey);
            state.credentialsValid = result.valid;
            
            if (result.valid) {
                Logger.log("Credentials are valid - favorites feature enabled");
                // Clear favorites cache when credentials change
                state.favoritesCache.clear();
            } else {
                Logger.log(`Credentials validation failed: ${result.error}`);
                state.credentialsValid = false;
            }
        } else {
            state.credentialsValid = false;
            state.favoritesCache.clear();
        }
    }

    closeSettingsPanel();
}

export function setupSettingsPanel() {
    elements.settingsButton.addEventListener('click', () => {
        if (!state.settingsPanelOpen) {
            openSettingsPanel();
        } else {
            closeSettingsPanel();
        }
    });

    document.getElementById('closesettingsbutton').addEventListener('click', closeSettingsPanel);
    elements.globalSettingsButton.addEventListener('click', openGlobalSettings);
    elements.globalPresetsButton.addEventListener('click', openPresetSettings);
    elements.creditsButton.addEventListener('click', openCredits);
    elements.searchButton.addEventListener('click', openSearchTab);
    document.getElementById("saveGlobalSettings").addEventListener('click', saveGlobalSettings);
    
    // Favorites fetch button
    elements.fetchFavoritesBtn.addEventListener('click', () => {
        fetchAndAnalyzeFavorites(true); // Force refresh
    });
}
