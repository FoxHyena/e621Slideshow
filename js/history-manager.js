import { state } from './state.js';
import { elements } from './dom-elements.js';
import Logger from './logger.js';
import { pause, unPause } from './helpers.js';
import { getHistoryPosInArray } from './helpers.js';
import { updateFavoriteButtonState } from './ui-controls.js';
import { checkIfFavorited } from './api-client.js';
import { clearPreloadQueue } from './image-fetcher.js';

export async function previousImage() {
    // Navigate backward in history (decrement negative position)
    // currentHistoryPos = 0 is newest, -1 is previous, -2 is before that, etc.
    if (state.currentHistoryPos > -state.urlHistory.length + 1) {
        await pause();
        clearPreloadQueue(); // Clear preloaded images when navigating backward
        state.currentHistoryPos--;
        const pos = getHistoryPosInArray();
        Logger.log('Previous image requested', pos);
        elements.mainImage.src = state.urlHistory[pos][0];
        
        // Update favorite status for the new image
        const postId = state.urlHistory[pos][1];
        state.currentPostId = postId;
        await updateFavoriteStatusForCurrentPost(postId);
    } else {
        Logger.log("Can't go back in history further");
    }
}

export async function nextImage() {
    // Navigate forward in history (increment negative position toward 0)
    // When currentHistoryPos reaches 0, we're at the newest image
    if (state.currentHistoryPos < 0) {
        state.currentHistoryPos++;
        const pos = getHistoryPosInArray();
        Logger.log('Next image requested', pos);
        elements.mainImage.src = state.urlHistory[pos][0];
        
        // Update favorite status for the new image
        const postId = state.urlHistory[pos][1];
        state.currentPostId = postId;
        await updateFavoriteStatusForCurrentPost(postId);
        
        if (state.currentHistoryPos == 0) {
            await unPause(true);
        }
    } else {
        Logger.log("Reached newest history item");
        await unPause();
    }
}

// Helper function to update favorite status for the current post
async function updateFavoriteStatusForCurrentPost(postId) {
    if (!state.credentialsValid) {
        updateFavoriteButtonState(false);
        return;
    }
    
    // Check cache first
    if (state.favoritesCache.has(postId)) {
        Logger.log(`[History] Post ${postId} found in favorites cache`);
        updateFavoriteButtonState(true);
    } else {
        // Check via API
        Logger.log(`[History] Checking favorite status for post ${postId}...`);
        const isFavorited = await checkIfFavorited(
            postId,
            state.globalSettings.username,
            state.globalSettings.apikey
        );
        
        if (isFavorited) {
            state.favoritesCache.add(postId);
        }
        
        updateFavoriteButtonState(isFavorited);
    }
}
