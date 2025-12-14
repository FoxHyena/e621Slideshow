import { state } from './state.js';
import { elements } from './dom-elements.js';
import Logger from './logger.js';
import { ERROR_TYPES } from './constants.js';
import { getNewImageUrl, preloadNextImages, prefetchNextBatch } from './image-fetcher.js';
import { showLoading, hideLoading, updateFavoriteButtonState, updateFavoriteButtonVisibility } from './ui-controls.js';
import { checkIfFavorited } from './api-client.js';

//recursive function that gets a new image and apply it to the screen, then waits and repeats
export async function imageLoop(skipNewSearch = false) {
    try {
        Logger.log(`[imageLoop] Called - skipNewSearch: ${skipNewSearch}, isSearchingForNewImage: ${state.isSearchingForNewImage}, paused: ${state.paused}, historySize: ${state.urlHistory.length}`);
        if (!skipNewSearch && !state.isSearchingForNewImage) {
            state.isSearchingForNewImage = true;
            Logger.log(`[imageLoop] Starting image search...`);
            try {
                let imageUrl = null;
                let preloadedImage = null;
                
                // Check if we have a preloaded image available
                if (state.preloadedImages.length > 0) {
                    preloadedImage = state.preloadedImages.shift(); // Remove from queue
                    imageUrl = preloadedImage.url;
                    Logger.log(`[imageLoop] Using preloaded image: ${imageUrl} (${state.preloadedImages.length} remaining in queue)`);
                    
                    // Add to history and update state (normally done in processBatch)
                    state.urlHistory.push([preloadedImage.url, preloadedImage.fileId]);
                    state.urlHistorySet.add(preloadedImage.fileId);
                    state.currentBatchIndex++;
                    state.currentHistoryPos--;
                    Logger.log(`[imageLoop] Added preloaded image to history. History size now: ${state.urlHistory.length}, batch index now: ${state.currentBatchIndex}`);
                    
                    // Trigger batch prefetching when halfway through the current batch (same as processBatch)
                    if (state.currentBatchIndex >= state.currentPostBatch.length * 0.5) {
                        Logger.log(`[imageLoop] Halfway through batch (${state.currentBatchIndex}/${state.currentPostBatch.length}), triggering batch prefetch`);
                        prefetchNextBatch(); // Fire and forget - don't await
                    }
                } else {
                    // No preloaded image, fetch normally
                    imageUrl = await getNewImageUrl();
                    Logger.log(`[imageLoop] getNewImageUrl returned: ${imageUrl !== null ? 'valid URL' : 'null'}`);
                }
                
                if (imageUrl !== null) {
                    let tempImage;
                    
                    if (preloadedImage) {
                        // Use the already-loaded image from preload queue
                        tempImage = preloadedImage.image;
                        Logger.log(`[imageLoop] Using preloaded image object (already loaded)`);
                    } else {
                        // Create a new image object and load it
                        tempImage = new Image();
                        tempImage.src = imageUrl;
                        Logger.log(`[imageLoop] Loading image: ${imageUrl}`);
                        
                        // Wait for the image to finish loading
                        await new Promise((resolve, reject) => {
                            if (state.firstImageLoaded) {
                                showLoading(true);
                            }
                            tempImage.onload = () => {
                                Logger.log(`[imageLoop] Image loaded successfully`);
                                resolve();
                            };
                            tempImage.onerror = () => {
                                Logger.error(`[imageLoop] Image load failed for: ${imageUrl}`);
                                reject(new Error(ERROR_TYPES.IMAGE_LOAD_FAILED));
                            };
                        });
                    }
                    
                    // after the new image finished loading, only show it if not paused (as could happen during download)
                    if (!state.paused && !state.pageIsHidden) {
                        // Update the main image element
                        elements.mainImage.src = imageUrl;
                        state.currentHistoryPos = 0;
                        state.firstImageLoaded = true;
                        hideLoading();
                        Logger.log(`[imageLoop] Image displayed successfully`);
                        
                        // Get the post ID from the most recent history entry
                        if (state.urlHistory.length > 0) {
                            const latestEntry = state.urlHistory[state.urlHistory.length - 1];
                            const postId = latestEntry[1]; // fileId is at index 1
                            state.currentPostId = postId;
                            Logger.log(`[imageLoop] Current post ID: ${postId}`);
                            
                            // Check if post is favorited and update button
                            if (state.credentialsValid) {
                                // Check cache first
                                if (state.favoritesCache.has(postId)) {
                                    Logger.log(`[imageLoop] Post ${postId} found in favorites cache`);
                                    updateFavoriteButtonState(true);
                                } else {
                                    // Check via API
                                    Logger.log(`[imageLoop] Checking favorite status for post ${postId}...`);
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
                                updateFavoriteButtonVisibility();
                            } else {
                                updateFavoriteButtonState(false);
                                updateFavoriteButtonVisibility();
                            }
                        }
                        
                        // Trigger preloading for next images
                        Logger.log(`[imageLoop] Triggering preload for next ${state.maxPreloadCount} images`);
                        preloadNextImages(state.maxPreloadCount);
                    } else {
                        Logger.log(`[imageLoop] Image loaded but not displayed (paused: ${state.paused}, pageIsHidden: ${state.pageIsHidden})`);
                    }
                } else {
                    Logger.log(`[imageLoop] No image URL returned, will retry on next loop`);
                }
            } finally {
                // Always reset the flag, even if getNewImageUrl() returned null or an error occurred
                state.isSearchingForNewImage = false;
                Logger.log(`[imageLoop] Reset isSearchingForNewImage flag`);
            }
        } else {
            Logger.log(`[imageLoop] Skipping search - skipNewSearch: ${skipNewSearch}, isSearchingForNewImage: ${state.isSearchingForNewImage}`);
        }
        if (!state.paused) {
            const refreshRateMs = parseFloat(state.presetSettings.refreshRate) * 1000;
            Logger.log(`[imageLoop] Scheduling next loop in ${state.presetSettings.refreshRate}s (${refreshRateMs}ms)`);
            clearTimeout(state.timeoutId); // Clear any existing timeout before setting a new one
            state.timeoutId = setTimeout(imageLoop, refreshRateMs);
        } else {
            Logger.log(`[imageLoop] Not scheduling next loop (paused: ${state.paused})`);
        }
    } catch (error) {
        Logger.error(`[imageLoop] Error in setImageLoop:`, error);
    }
}
