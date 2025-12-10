import { state } from './state.js';

// Build complete query string including tags and blacklist
export function buildQueryString() {
    // Return cached query string if available
    if (state.cachedQueryString !== null) {
        return state.cachedQueryString;
    }

    // Combine global and preset tags
    let tags = state.globalSettings.globaltags.split(" ");
    tags = tags.concat(state.presetSettings.tags.split(" "));
    tags = tags.filter(tag => tag.trim() !== "");

    // Combine global and preset blacklist tags, prefix with '-'
    let blacklist = state.globalSettings.globalblacklist.split(" ");
    let presetblacklist = state.presetSettings.blacklist.split(" ");
    blacklist = blacklist.concat(presetblacklist);
    blacklist = blacklist.filter(item => item.trim() !== '');

    // Prefix blacklist tags with '-' for e621 API exclusion syntax
    const negatedBlacklist = blacklist.map(tag => `-${tag}`);

    // Automatically exclude video file types (webm, mp4) using e621's filetype: filter
    // This is more efficient than filtering in code after fetching
    const excludedFileTypes = ['-filetype:webm', '-filetype:mp4'];

    // Combine all tags, blacklist tags, and file type exclusions
    const allTags = tags.concat(negatedBlacklist).concat(excludedFileTypes);

    // Cache and return the result
    state.cachedQueryString = allTags.join(' ');
    return state.cachedQueryString;
}

// Invalidate the query string cache (call when settings change)
export function invalidateQueryStringCache() {
    state.cachedQueryString = null;
}

// Get the base API URL based on adult mode and preset settings
export function getApiBaseUrl() {
    if (state.adultMode && state.presetSettings.adultcontent) {
        return state.config.url_e621;
    } else {
        return state.config.url_e926;
    }
}

// Build complete API URL for posts endpoint
export function buildPostsApiUrl(queryParams) {
    return `${getApiBaseUrl()}/posts.json/?${queryParams}`;
}

// Build API URL for a specific post
export function buildPostApiUrl(postId) {
    return `${getApiBaseUrl()}/posts/${postId}`;
}

// Build API URL for favorites endpoint
export function buildFavoritesApiUrl() {
    return `${getApiBaseUrl()}/favorites.json`;
}

// Build API URL for a specific favorite
export function buildFavoriteApiUrl(postId) {
    return `${getApiBaseUrl()}/favorites/${postId}.json`;
}

// Validate user credentials by attempting to fetch favorites
export async function validateCredentials(username, apiKey) {
    if (!username || !apiKey || username.trim() === '' || apiKey.trim() === '') {
        return { valid: false, error: 'Username and API key are required' };
    }

    try {
        const url = `${buildFavoritesApiUrl()}?limit=1`;
        const headers = {
            'Authorization': `Basic ${btoa(`${username}:${apiKey}`)}`,
            'User-Agent': 'e621AutoViewer (by Leithey)'
        };

        const response = await fetch(url, { headers });
        
        if (response.ok) {
            return { valid: true };
        } else if (response.status === 401 || response.status === 403) {
            return { valid: false, error: 'Invalid credentials' };
        } else {
            return { valid: false, error: `HTTP error ${response.status}` };
        }
    } catch (error) {
        return { valid: false, error: `Network error: ${error.message}` };
    }
}

// Check if a specific post is favorited
export async function checkIfFavorited(postId, username, apiKey) {
    if (!username || !apiKey || !postId) {
        return false;
    }

    try {
        // We need to fetch the user's favorites and check if this post is in there
        // Unfortunately, e621 API doesn't have a direct "is favorited" endpoint
        // We'll need to search through favorites or rely on the post data
        const url = `${getApiBaseUrl()}/posts/${postId}.json`;
        const headers = {
            'Authorization': `Basic ${btoa(`${username}:${apiKey}`)}`,
            'User-Agent': 'e621AutoViewer (by Leithey)'
        };

        const response = await fetch(url, { headers });
        
        if (response.ok) {
            const data = await response.json();
            // The post object has an is_favorited property when authenticated
            return data.post && data.post.is_favorited === true;
        }
        return false;
    } catch (error) {
        console.error('Error checking favorite status:', error);
        return false;
    }
}

// Add a post to favorites
export async function addToFavorites(postId, username, apiKey) {
    if (!username || !apiKey || !postId) {
        return { success: false, error: 'Missing required parameters' };
    }

    try {
        const url = buildFavoritesApiUrl();
        const headers = {
            'Authorization': `Basic ${btoa(`${username}:${apiKey}`)}`,
            'User-Agent': 'e621AutoViewer (by Leithey)',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const body = new URLSearchParams({ 'post_id': postId });

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (response.ok) {
            return { success: true };
        } else {
            const errorText = await response.text();
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }
    } catch (error) {
        return { success: false, error: `Network error: ${error.message}` };
    }
}

// Remove a post from favorites
export async function removeFromFavorites(postId, username, apiKey) {
    if (!username || !apiKey || !postId) {
        return { success: false, error: 'Missing required parameters' };
    }

    try {
        const url = buildFavoriteApiUrl(postId);
        const headers = {
            'Authorization': `Basic ${btoa(`${username}:${apiKey}`)}`,
            'User-Agent': 'e621AutoViewer (by Leithey)'
        };

        const response = await fetch(url, {
            method: 'DELETE',
            headers: headers
        });

        if (response.ok || response.status === 204) {
            return { success: true };
        } else {
            const errorText = await response.text();
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }
    } catch (error) {
        return { success: false, error: `Network error: ${error.message}` };
    }
}
