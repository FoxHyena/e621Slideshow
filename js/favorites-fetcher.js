import { state } from './state.js';
import { getApiBaseUrl } from './api-client.js';
import Logger from './logger.js';

// Constants
const FAVORITES_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const FAVORITES_PER_PAGE = 320; // Max allowed by e621 API
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Sleep utility for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get cached favorites from localStorage
export function getCachedFavorites() {
    try {
        const cacheData = localStorage.getItem('favoritesCache');
        if (!cacheData) {
            return null;
        }
        
        const cache = JSON.parse(cacheData);
        
        // Validate cache structure
        if (!cache.favoritesPosts || !cache.favoritesLastFetched || !cache.favoritesUsername) {
            Logger.log('[getCachedFavorites] Invalid cache structure, returning null');
            return null;
        }
        
        return cache;
    } catch (error) {
        Logger.error('[getCachedFavorites] Error reading cache:', error);
        return null;
    }
}

// Check if favorites cache is valid (not expired and username matches)
export function isFavoritesCacheValid(username) {
    if (!username) {
        return false;
    }
    
    const cache = getCachedFavorites();
    if (!cache) {
        return false;
    }
    
    // Check if username matches
    if (cache.favoritesUsername !== username) {
        Logger.log('[isFavoritesCacheValid] Username mismatch, cache invalid');
        return false;
    }
    
    // Check if cache is expired
    const now = Date.now();
    const age = now - cache.favoritesLastFetched;
    
    if (age > FAVORITES_CACHE_DURATION) {
        Logger.log('[isFavoritesCacheValid] Cache expired (age: ' + Math.round(age / 1000 / 60) + ' minutes)');
        return false;
    }
    
    Logger.log('[isFavoritesCacheValid] Cache valid (age: ' + Math.round(age / 1000 / 60) + ' minutes)');
    return true;
}

// Clear favorites cache
export function clearFavoritesCache() {
    try {
        localStorage.removeItem('favoritesCache');
        state.favoritesCachedData = null;
        state.analyzedTags = null;
        Logger.log('[clearFavoritesCache] Cache cleared');
    } catch (error) {
        Logger.error('[clearFavoritesCache] Error clearing cache:', error);
    }
}

// Fetch all favorites from e621 API with pagination and rate limiting
export async function fetchAllFavorites(username, apiKey, progressCallback = null) {
    if (!username || !apiKey) {
        throw new Error('Username and API key are required');
    }
    
    Logger.log('[fetchAllFavorites] Starting fetch for user:', username);
    
    const baseUrl = getApiBaseUrl();
    const allFavorites = [];
    let page = 1;
    let hasMorePages = true;
    
    const headers = {
        'Authorization': `Basic ${btoa(`${username}:${apiKey}`)}`,
        'User-Agent': 'e621AutoViewer (by Leithey)'
    };
    
    try {
        while (hasMorePages) {
            // Show progress
            if (progressCallback) {
                progressCallback({ page, total: null, fetched: allFavorites.length });
            }
            
            // Build URL for this page
            const url = `${baseUrl}/favorites.json?limit=${FAVORITES_PER_PAGE}&page=${page}`;
            
            Logger.log(`[fetchAllFavorites] Fetching page ${page}...`);
            
            // Fetch favorites page
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Invalid credentials');
                } else if (response.status === 404) {
                    // No more pages
                    Logger.log('[fetchAllFavorites] No more pages (404)');
                    hasMorePages = false;
                    break;
                } else {
                    throw new Error(`HTTP error ${response.status}`);
                }
            }
            
            const data = await response.json();
            
            // e621 favorites endpoint returns { posts: [...] }
            if (!data.posts || data.posts.length === 0) {
                Logger.log('[fetchAllFavorites] No more favorites found');
                hasMorePages = false;
                break;
            }
            
            // Extract relevant data from each favorite post
            for (const post of data.posts) {
                allFavorites.push({
                    id: post.id,
                    tags: extractAllTags(post.tags), // Flatten tag object into array
                    score: post.score.total,
                    created_at: post.created_at
                });
            }
            
            Logger.log(`[fetchAllFavorites] Page ${page} complete: ${data.posts.length} favorites`);
            
            // Check if we got fewer posts than the limit (last page)
            if (data.posts.length < FAVORITES_PER_PAGE) {
                Logger.log('[fetchAllFavorites] Last page detected (fewer posts than limit)');
                hasMorePages = false;
            } else {
                page++;
                // Rate limiting: wait 1 second before next request
                await sleep(RATE_LIMIT_DELAY);
            }
        }
        
        Logger.log(`[fetchAllFavorites] Fetch complete: ${allFavorites.length} total favorites`);
        
        // Cache the results
        const cacheData = {
            favoritesPosts: allFavorites,
            favoritesLastFetched: Date.now(),
            favoritesUsername: username
        };
        
        try {
            localStorage.setItem('favoritesCache', JSON.stringify(cacheData));
            Logger.log('[fetchAllFavorites] Cache saved successfully');
        } catch (storageError) {
            Logger.error('[fetchAllFavorites] Error saving to localStorage:', storageError);
            // Continue anyway - we still have the data in memory
        }
        
        // Update state
        state.favoritesCachedData = cacheData;
        
        // Final progress update
        if (progressCallback) {
            progressCallback({ page: page, total: page, fetched: allFavorites.length, complete: true });
        }
        
        return allFavorites;
        
    } catch (error) {
        Logger.error('[fetchAllFavorites] Error fetching favorites:', error);
        throw error;
    }
}

// Extract all tags from e621 tag object into a single array
function extractAllTags(tagObject) {
    const allTags = [];
    
    // e621 returns tags in categories: general, species, character, artist, etc.
    if (tagObject.general) allTags.push(...tagObject.general);
    if (tagObject.species) allTags.push(...tagObject.species);
    if (tagObject.character) allTags.push(...tagObject.character);
    if (tagObject.copyright) allTags.push(...tagObject.copyright);
    if (tagObject.artist) allTags.push(...tagObject.artist);
    if (tagObject.invalid) allTags.push(...tagObject.invalid);
    if (tagObject.lore) allTags.push(...tagObject.lore);
    if (tagObject.meta) allTags.push(...tagObject.meta);
    
    return allTags;
}

// Load favorites (from cache if valid, otherwise fetch)
export async function loadFavorites(username, apiKey, progressCallback = null, forceRefresh = false) {
    // Check cache first unless force refresh
    if (!forceRefresh && isFavoritesCacheValid(username)) {
        Logger.log('[loadFavorites] Using cached favorites');
        const cache = getCachedFavorites();
        state.favoritesCachedData = cache;
        return cache.favoritesPosts;
    }
    
    // Fetch new favorites
    Logger.log('[loadFavorites] Fetching new favorites...');
    return await fetchAllFavorites(username, apiKey, progressCallback);
}
