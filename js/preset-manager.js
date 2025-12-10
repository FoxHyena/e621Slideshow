import { state } from './state.js';
import { elements } from './dom-elements.js';
import Logger from './logger.js';
import { normalizeRefreshRate, updateDocumentTitle } from './helpers.js';
import { invalidateQueryStringCache } from './api-client.js';
import { closeSettingsPanel } from './settings-manager.js';
import { openPresetSettings } from './settings-manager.js';
import { getCachedFavorites, isFavoritesCacheValid } from './favorites-fetcher.js';
import { analyzeTagsFromFavorites, canMakeRecommendations } from './tag-analyzer.js';

export function createNewPreset() {
    var newPreset = {
        "presetName": "New Preset",
        "refreshRate": "10",
        "tags": "",
        "blacklist": "",
        "whitelist": "",
        "adultcontent": "true",
    };
    state.presetsData.push(newPreset);
    addPresetItem(newPreset.presetName);
}

// Function to add a new preset item
export function addPresetItem(name) {
    const newPreset = document.createElement('div');
    newPreset.classList.add('presetItem');
    newPreset.textContent = name;
    newPreset.title = name; // Show full name in tooltip when hovering
    newPreset.dataset.index = elements.presetList.children.length;
    newPreset.addEventListener('click', function () {
        let index = parseInt(newPreset.dataset.index);
        loadPreset(index);
    });
    elements.presetList.appendChild(newPreset);
}

export async function loadPresets(reset = false) {
    try {
        let localPresetsData = localStorage.getItem("presetsData");

        state.selectedPreset = localStorage.getItem("selectedPreset");
        if (state.selectedPreset === null || state.selectedPreset === undefined) {
            state.selectedPreset = 0;
        } else {
            state.selectedPreset = parseInt(state.selectedPreset);
        }

        if (!reset && localPresetsData) {
            state.presetsData = JSON.parse(localPresetsData);
            // Migrate refreshRate values from milliseconds to seconds if needed
            for (let i = 0; i < state.presetsData.length; i++) {
                if (state.presetsData[i].refreshRate) {
                    state.presetsData[i].refreshRate = normalizeRefreshRate(state.presetsData[i].refreshRate);
                }
            }
            // Save migrated presets back to localStorage
            savePresets();

        } else {
            const response = await fetch('presets.json');
            if (!response.ok) {
                throw new Error(`Failed to fetch presets.json: ${response.status}`);
            }
            state.presetsData = await response.json();
        }
    } catch (error) {
        Logger.error('Error loading presets:', error);
        state.presetsData = []; // Return an empty array in case of error
    }

    elements.presetList.innerHTML = ""; //clear list

    for (var i = 0; i < state.presetsData.length; i++) {
        addPresetItem(state.presetsData[i].presetName);
    }
    loadPreset(state.selectedPreset);
    
    // Check if there's a saved temporary search to restore
    const savedTemporarySearch = localStorage.getItem("temporarySearch");
    const savedTemporarySearchActive = localStorage.getItem("temporarySearchActive");
    
    if (savedTemporarySearchActive === "true" && savedTemporarySearch) {
        try {
            const tempPreset = JSON.parse(savedTemporarySearch);
            // Migrate refreshRate from milliseconds to seconds if needed
            if (tempPreset.refreshRate) {
                tempPreset.refreshRate = normalizeRefreshRate(tempPreset.refreshRate);
            }
            state.presetSettings = tempPreset;
            state.temporarySearchActive = true;
            state.savedPresetSettings = state.presetsData[state.selectedPreset]; // Save the preset that was loaded
            
            // Reset batch cache for the temporary search
            state.currentPostBatch = [];
            state.currentBatchIndex = 0;
            state.currentBatchPage = 1;
            state.currentBatchQuery = "";
            state.prefetchedBatch = [];
            state.prefetchedPage = null;
            state.prefetchPromise = null;
            invalidateQueryStringCache();
            
            Logger.log("Restored temporary search from previous session:", tempPreset.presetName);
        } catch (error) {
            Logger.error("Error restoring temporary search:", error);
            localStorage.removeItem("temporarySearch");
            localStorage.removeItem("temporarySearchActive");
        }
    }
}

export function loadPreset(index) {
    // Deactivate recommendation mode when loading a regular preset
    if (state.recommendationMode) {
        deactivateRecommendationMode();
    }
    
    state.presetSettings = state.presetsData[index];
    
    // Migrate refreshRate from milliseconds to seconds if needed
    state.presetSettings.refreshRate = normalizeRefreshRate(state.presetSettings.refreshRate);

    document.getElementById("presetName").value = state.presetSettings.presetName;
    document.getElementById("refreshRate").value = state.presetSettings.refreshRate;
    document.getElementById("tags").value = state.presetSettings.tags;
    document.getElementById("blacklist").value = state.presetSettings.blacklist;
    document.getElementById("whitelist").value = state.presetSettings.whitelist;
    document.getElementById("adultcontent").checked = state.presetSettings.adultcontent;

    state.selectedPreset = index;
    
    // Clear temporary search state when loading a preset
    state.temporarySearchActive = false;
    state.savedPresetSettings = null;
    localStorage.removeItem("temporarySearch");
    localStorage.removeItem("temporarySearchActive");

    // Reset batch cache when preset changes (tags will be different)
    state.currentPostBatch = [];
    state.currentBatchIndex = 0;
    state.currentBatchPage = 1;
    state.currentBatchQuery = "";
    // Also clear prefetch state
    state.prefetchedBatch = [];
    state.prefetchedPage = null;
    state.prefetchPromise = null;
    // Invalidate query string cache since preset tags changed
    invalidateQueryStringCache();

    const highlightedPreset = document.querySelector(".presetItem.selected");
    if (highlightedPreset) {
        highlightedPreset.classList.remove("selected");
    }
    elements.presetList.children[index].classList.add("selected");

    localStorage.setItem("selectedPreset", index);
    Logger.log("Preset loaded:", state.presetSettings.presetName);
    updateDocumentTitle();
}

export function savePreset(index) {
    Logger.log(index);
    var NameValue = document.getElementById("presetName").value;
    var refreshRateValue = document.getElementById("refreshRate").value;
    var tagsValue = document.getElementById("tags").value;
    var blacklistValue = document.getElementById("blacklist").value;
    var whitelistValue = document.getElementById("whitelist").value;
    var adultcontentValue = document.getElementById("adultcontent").checked;

    var presetSettings = {
        "presetName": NameValue,
        "refreshRate": refreshRateValue,
        "tags": tagsValue,
        "blacklist": blacklistValue,
        "whitelist": whitelistValue,
        "adultcontent": adultcontentValue,
    };

    elements.presetList.children[index].textContent = NameValue;

    state.presetsData[index] = presetSettings;

    Logger.log("Preset Saved:", index, NameValue);

    savePresets();
    loadPreset(index);
    closeSettingsPanel();
}

export function savePresets() {
    let presetsJSON = JSON.stringify(state.presetsData);

    localStorage.setItem("presetsData", presetsJSON);
}

export function deletePreset(index) {
    state.presetsData.splice(index, 1);
    elements.presetList.removeChild(elements.presetList.children[index]);
    state.selectedPreset--;

    loadPreset(state.selectedPreset);
    savePresets();
}

export function resetPresets() {
    Logger.log("Resetting Presets");
    loadPresets(true);
}

export function loadTemporarySearch() {
    // Deactivate recommendation mode when loading a temporary search
    if (state.recommendationMode) {
        deactivateRecommendationMode();
    }
    
    // Save current preset settings as backup
    if (!state.temporarySearchActive) {
        state.savedPresetSettings = { ...state.presetSettings };
    }
    
    // Get refresh rate, use default if empty
    const refreshRateValue = document.getElementById("searchRefreshRate").value.trim();
    const refreshRate = refreshRateValue === "" ? "10" : refreshRateValue;
    
    // Create temporary preset from search inputs
    const tempPreset = {
        presetName: "Temporary Search",
        refreshRate: refreshRate,
        tags: document.getElementById("searchTags").value,
        blacklist: document.getElementById("searchBlacklist").value,
        whitelist: document.getElementById("searchWhitelist").value,
        adultcontent: document.getElementById("searchAdultContent").checked
    };
    
    // Set temporary preset as current preset
    state.presetSettings = tempPreset;
    state.temporarySearchActive = true;
    
    // Save temporary search to localStorage for persistence across page refreshes
    localStorage.setItem("temporarySearch", JSON.stringify(tempPreset));
    localStorage.setItem("temporarySearchActive", "true");
    
    // Reset batch cache when search changes (tags will be different)
    state.currentPostBatch = [];
    state.currentBatchIndex = 0;
    state.currentBatchPage = 1;
    state.currentBatchQuery = "";
    // Also clear prefetch state
    state.prefetchedBatch = [];
    state.prefetchedPage = null;
    state.prefetchPromise = null;
    // Invalidate query string cache since preset tags changed
    invalidateQueryStringCache();
    
    // Update document title
    updateDocumentTitle();
    
    Logger.log("Temporary search loaded:", state.presetSettings.presetName);
    
    // Close settings and start playing
    closeSettingsPanel();
}

export function showPresetNamePrompt() {
    // Reset the input and error message
    elements.presetNameInput.value = "New Search Preset";
    elements.presetNameError.style.display = "none";
    elements.presetNameError.textContent = "";
    
    // Show the modal
    elements.presetNamePrompt.style.display = "flex";
    
    // Focus the input
    elements.presetNameInput.focus();
    elements.presetNameInput.select();
}

export function hidePresetNamePrompt() {
    elements.presetNamePrompt.style.display = "none";
    elements.presetNameInput.value = "";
    elements.presetNameError.style.display = "none";
    elements.presetNameError.textContent = "";
}

export function confirmPresetName() {
    let presetName = elements.presetNameInput.value.trim();
    
    // Validate input
    if (presetName === "") {
        elements.presetNameError.textContent = "Preset name cannot be empty!";
        elements.presetNameError.style.display = "block";
        return;
    }
    
    // Check for duplicate names
    const duplicateExists = state.presetsData.some(preset => preset.presetName === presetName);
    if (duplicateExists) {
        elements.presetNameError.textContent = `A preset named "${presetName}" already exists. Please choose a different name.`;
        elements.presetNameError.style.display = "block";
        return;
    }
    
    // Hide the modal
    hidePresetNamePrompt();
    
    // Get refresh rate, use default if empty
    const refreshRateValue = document.getElementById("searchRefreshRate").value.trim();
    const refreshRate = refreshRateValue === "" ? "10" : refreshRateValue;
    
    // Create new preset from search inputs
    const newPreset = {
        presetName: presetName,
        refreshRate: refreshRate,
        tags: document.getElementById("searchTags").value,
        blacklist: document.getElementById("searchBlacklist").value,
        whitelist: document.getElementById("searchWhitelist").value,
        adultcontent: document.getElementById("searchAdultContent").checked
    };
    
    // Add to presets data
    state.presetsData.push(newPreset);
    
    // Add to UI
    addPresetItem(newPreset.presetName);
    
    // Save to localStorage
    savePresets();
    
    // Load the newly created preset
    const newPresetIndex = state.presetsData.length - 1;
    loadPreset(newPresetIndex);
    
    Logger.log("Search saved as preset:", presetName);
    
    // Switch to presets tab to show the result
    openPresetSettings();
}

// Activate recommendation mode
export function activateRecommendationMode() {
    // Check if we have credentials
    if (!state.globalSettings || !state.globalSettings.username || !state.globalSettings.apikey) {
        alert('Please set your e621 username and API key in Global Settings to use recommendations.');
        return;
    }
    
    // Check if we have cached favorites
    if (!isFavoritesCacheValid(state.globalSettings.username)) {
        alert('Please analyze your favorites first by clicking "Analyze Favorites" in Global Settings.');
        return;
    }
    
    // Load cached favorites
    const cache = getCachedFavorites();
    if (!cache || !cache.favoritesPosts || cache.favoritesPosts.length === 0) {
        alert('No favorites found. Please analyze your favorites first.');
        return;
    }
    
    // Check if we can make recommendations
    const validation = canMakeRecommendations(cache.favoritesPosts);
    if (!validation.valid) {
        alert(`Cannot generate recommendations: ${validation.reason}`);
        return;
    }
    
    // Analyze tags if not already done
    if (!state.analyzedTags || state.analyzedTags.length === 0) {
        Logger.log('[activateRecommendationMode] Analyzing tags...');
        analyzeTagsFromFavorites(cache.favoritesPosts);
    }
    
    // Ensure we have preset settings (use current or create minimal)
    if (!state.presetSettings) {
        state.presetSettings = {
            presetName: "Recommended",
            refreshRate: "10",
            tags: "",
            blacklist: "",
            whitelist: "",
            adultcontent: true
        };
    }
    
    // Activate recommendation mode
    state.recommendationMode = true;
    state.favoritesCachedData = cache;
    
    // Clear temporary search
    state.temporarySearchActive = false;
    state.savedPresetSettings = null;
    localStorage.removeItem("temporarySearch");
    localStorage.removeItem("temporarySearchActive");
    
    // Reset batch cache
    state.currentPostBatch = [];
    state.currentBatchIndex = 0;
    state.currentBatchPage = 1;
    state.currentBatchQuery = "";
    state.prefetchedBatch = [];
    state.prefetchedPage = null;
    state.prefetchPromise = null;
    invalidateQueryStringCache();
    
    // Show time period selector
    elements.timePeriodSelector.style.display = 'block';
    
    // Highlight the recommended button
    elements.recommendedPresetBtn.style.backgroundColor = 'var(--e621-button-hover)';
    
    // Remove selection from presets
    const highlightedPreset = document.querySelector(".presetItem.selected");
    if (highlightedPreset) {
        highlightedPreset.classList.remove("selected");
    }
    
    // Show simplified settings for recommendations (hide preset-specific fields)
    // Hide preset name, tags, save/delete buttons
    const presetNameDiv = document.querySelector('#settingscolumn > div[style*="margin-bottom: 15px"]');
    const tagsDiv = document.querySelector('label[for="tags"]')?.parentElement;
    const saveButton = document.getElementById('savePreset');
    const deleteButton = document.getElementById('deletePreset');
    
    if (presetNameDiv) presetNameDiv.style.display = 'none';
    if (tagsDiv) tagsDiv.style.display = 'none';
    if (saveButton) saveButton.style.display = 'none';
    if (deleteButton) deleteButton.style.display = 'none';
    
    // Keep blacklist, whitelist, refresh rate, and adult content visible
    // These still apply to recommendations
    
    Logger.log('[activateRecommendationMode] Recommendation mode activated');
    Logger.log(`[activateRecommendationMode] Using ${cache.favoritesPosts.length} favorites, ${state.analyzedTags.length} analyzed tags`);
    
    updateDocumentTitle();
    // Don't auto-close settings panel - let user adjust time period and see results
}

// Deactivate recommendation mode
export function deactivateRecommendationMode() {
    state.recommendationMode = false;
    
    // Hide time period selector
    elements.timePeriodSelector.style.display = 'none';
    
    // Reset button style
    elements.recommendedPresetBtn.style.backgroundColor = 'var(--e621-button-primary)';
    
    // Show all preset settings again
    const presetNameDiv = document.querySelector('#settingscolumn > div[style*="margin-bottom: 15px"]');
    const tagsDiv = document.querySelector('label[for="tags"]')?.parentElement;
    const saveButton = document.getElementById('savePreset');
    const deleteButton = document.getElementById('deletePreset');
    
    if (presetNameDiv) presetNameDiv.style.display = 'flex';
    if (tagsDiv) tagsDiv.style.display = 'flex';
    if (saveButton) saveButton.style.display = 'inline-block';
    if (deleteButton) deleteButton.style.display = 'inline-block';
    
    Logger.log('[deactivateRecommendationMode] Recommendation mode deactivated');
}

// Update time period for recommendations
export function updateRecommendationTimePeriod(period) {
    state.recommendationTimePeriod = period;
    
    // Reset batch cache to fetch new results
    state.currentPostBatch = [];
    state.currentBatchIndex = 0;
    state.currentBatchPage = 1;
    state.currentBatchQuery = "";
    state.prefetchedBatch = [];
    state.prefetchedPage = null;
    state.prefetchPromise = null;
    invalidateQueryStringCache();
    
    Logger.log(`[updateRecommendationTimePeriod] Time period changed to: ${period}`);
}

export function setupPresetManager() {
    document.getElementById('addPresetBtn').addEventListener('click', createNewPreset);
    document.getElementById('savePreset').addEventListener('click', function () { savePreset(state.selectedPreset); });
    document.getElementById('deletePreset').addEventListener('click', function () { deletePreset(state.selectedPreset); });
    document.getElementById('resetPresetsBtn').addEventListener('click', resetPresets);
    document.getElementById('playSearchBtn').addEventListener('click', loadTemporarySearch);
    document.getElementById('saveSearchAsPresetBtn').addEventListener('click', showPresetNamePrompt);
    
    // Recommendation mode event listeners
    elements.recommendedPresetBtn.addEventListener('click', activateRecommendationMode);
    elements.timePeriodSelect.addEventListener('change', function(e) {
        updateRecommendationTimePeriod(e.target.value);
    });
    
    // Event listeners for the preset name modal
    elements.presetNameCancel.addEventListener('click', hidePresetNamePrompt);
    elements.presetNameConfirm.addEventListener('click', confirmPresetName);
    
    // Handle Enter key in the input field
    elements.presetNameInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmPresetName();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hidePresetNamePrompt();
        }
    });
    
    // Close modal when clicking outside of it
    elements.presetNamePrompt.addEventListener('click', function(e) {
        if (e.target === elements.presetNamePrompt) {
            hidePresetNamePrompt();
        }
    });
}
