import { state } from './state.js';
import { elements } from './dom-elements.js';
import Logger from './logger.js';
import { MOUSE_HIDE_TIMEOUT_MS } from './constants.js';
import { addToFavorites, removeFromFavorites } from './api-client.js';

export function showLoading(showOnTop = false) {
    if (showOnTop) {
        elements.loadingtop.style.display = 'block';
        elements.loadingtop.style.top = "20px";
    } else {
        elements.mainImage.style.display = "none";
        elements.loading.style.display = 'block';
        elements.loading.style.top = "50%";
    }
}

export function hideLoading() {
    elements.mainImage.style.display = "block";
    elements.loading.style.display = 'none';
    elements.loadingtop.style.display = 'none';
}

export function showNoImagesError() {
    hideLoading();
    Logger.log(`No images found.`);
    elements.noImagesFound.style.display = 'block';
    elements.mainImage.style.display = "none";
}

export function hideNoImagesError() {
    elements.noImagesFound.style.display = 'none';
    elements.mainImage.style.display = "block";
}

// Function to hide the cursor after a period of inactivity
export function hideCursor() {
    document.body.style.cursor = 'none';
    state.cursorHidden = true;
}

// Function to show the cursor
export function showCursor() {
    document.body.style.cursor = 'auto';
    state.cursorHidden = false;
}

let blockHideEvents = false; //if true, don't hide the settings button and mouse cursor

// Event listener to track mouse movements
export function setupMouseTracking() {
    document.addEventListener('mousemove', () => {
        // Show settings button when mouse is moved
        elements.settingsButton.style.display = 'block';
        if (state.firstImageLoaded) {
            elements.sourceButton.style.display = 'block';
            elements.downloadButton.style.display = 'block';
            // Only show favorite button if credentials are valid
            if (state.credentialsValid) {
                elements.favoriteButton.style.display = 'block';
            }
        }
        clearTimeout(state.hideTimeout); // Clear the timeout if settings button is visible

        // Hide the cursor after a period of inactivity
        if (state.cursorHidden) {
            showCursor(); // Show the cursor if it's hidden
        }
        state.hideTimeout = setTimeout(mouseStoppedMoving, MOUSE_HIDE_TIMEOUT_MS); // Hide the cursor after inactivity
    });

    function mouseStoppedMoving() {
        if (!blockHideEvents && !state.settingsPanelOpen) {
            elements.settingsButton.style.display = 'none';
            elements.sourceButton.style.display = 'none';
            elements.downloadButton.style.display = 'none';
            elements.favoriteButton.style.display = 'none';
            hideCursor();
        }
    }

    // Event listener to clear timeout when mouse enters settings button area
    elements.settingsButton.addEventListener('mouseenter', () => {
        blockHideEvents = true;
    });

    // Event listener to hide settings button when mouse leaves settings button area
    elements.settingsButton.addEventListener('mouseleave', () => {
        blockHideEvents = false;
    });
}

// Update favorite button visibility based on credentials
export function updateFavoriteButtonVisibility() {
    if (state.credentialsValid && state.firstImageLoaded) {
        // Button will be shown on mouse movement via setupMouseTracking
        Logger.log("[Favorites] Button enabled (credentials valid)");
    } else {
        elements.favoriteButton.style.display = 'none';
        Logger.log("[Favorites] Button disabled (credentials invalid or no image loaded)");
    }
}

// Update favorite button state (gold if favorited, white if not)
export function updateFavoriteButtonState(isFavorited) {
    state.currentPostIsFavorited = isFavorited;
    if (isFavorited) {
        elements.favoriteButton.classList.add('favorited');
        Logger.log("[Favorites] Button state: favorited (gold)");
    } else {
        elements.favoriteButton.classList.remove('favorited');
        Logger.log("[Favorites] Button state: not favorited (white)");
    }
}

// Setup favorite button click handler
export function setupFavoriteButton() {
    elements.favoriteButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent triggering pause/unpause
        
        if (!state.credentialsValid) {
            Logger.log("[Favorites] Cannot toggle - credentials not valid");
            return;
        }

        if (!state.currentPostId) {
            Logger.log("[Favorites] Cannot toggle - no current post ID");
            return;
        }

        // Disable button during API call
        elements.favoriteButton.disabled = true;
        elements.favoriteButton.style.opacity = '0.5';

        try {
            if (state.currentPostIsFavorited) {
                // Remove from favorites
                Logger.log(`[Favorites] Removing post ${state.currentPostId} from favorites...`);
                const result = await removeFromFavorites(
                    state.currentPostId,
                    state.globalSettings.username,
                    state.globalSettings.apikey
                );

                if (result.success) {
                    Logger.log("[Favorites] Successfully removed from favorites");
                    updateFavoriteButtonState(false);
                    state.favoritesCache.delete(state.currentPostId);
                } else {
                    Logger.error(`[Favorites] Failed to remove: ${result.error}`);
                }
            } else {
                // Add to favorites
                Logger.log(`[Favorites] Adding post ${state.currentPostId} to favorites...`);
                const result = await addToFavorites(
                    state.currentPostId,
                    state.globalSettings.username,
                    state.globalSettings.apikey
                );

                if (result.success) {
                    Logger.log("[Favorites] Successfully added to favorites");
                    updateFavoriteButtonState(true);
                    state.favoritesCache.add(state.currentPostId);
                } else {
                    Logger.error(`[Favorites] Failed to add: ${result.error}`);
                }
            }
        } catch (error) {
            Logger.error("[Favorites] Error toggling favorite:", error);
        } finally {
            // Re-enable button
            elements.favoriteButton.disabled = false;
            elements.favoriteButton.style.opacity = '1';
        }
    });
}
