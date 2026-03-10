const axios = require("axios");

/**
 * Emby Catalog Module
 * Provides catalog functionality for browsing Emby library content
 */

const HEADER_EMBY_TOKEN = 'X-Emby-Token';

/**
 * Fetches items from Emby library with pagination
 * @param {object} config - Configuration with serverUrl, userId, accessToken
 * @param {string} type - Item type: 'movie' or 'series'
 * @param {number} skip - Number of items to skip (for pagination)
 * @param {number} limit - Number of items to return
 * @returns {Promise<Array>} Array of catalog items in Stremio format
 */
async function getCatalogItems(config, type, skip = 0, limit = 100) {
    try {
        const itemType = type === 'movie' ? 'Movie' : 'Series';
        
        const response = await axios({
            method: 'get',
            url: `${config.serverUrl}/Users/${config.userId}/Items`,
            headers: { [HEADER_EMBY_TOKEN]: config.accessToken },
            params: {
                IncludeItemTypes: itemType,
                Recursive: true,
                Fields: 'ProviderIds,Overview,PremiereDate,CommunityRating,OfficialRating,Genres',
                SortBy: 'SortName',
                SortOrder: 'Ascending',
                StartIndex: skip,
                Limit: limit,
                Filters: 'IsNotFolder'
            },
            timeout: 15000
        });

        const items = response.data?.Items || [];
        return items.map(item => convertToStremioCatalogItem(item, type, config));
    } catch (err) {
        console.error('Error fetching catalog items:', err.message);
        return [];
    }
}

/**
 * Converts an Emby item to Stremio catalog format
 * @param {object} embyItem - Emby item object
 * @param {string} type - 'movie' or 'series'
 * @param {object} config - Configuration with serverUrl
 * @returns {object} Stremio catalog item
 */
function convertToStremioCatalogItem(embyItem, type, config) {
    const providerIds = embyItem.ProviderIds || {};
    
    // Determine the ID to use (prefer IMDb, then TMDb)
    let id = providerIds.Imdb;
    if (!id && providerIds.Tmdb) {
        id = `tmdb:${providerIds.Tmdb}`;
    } else if (!id && providerIds.Tvdb) {
        id = `tvdb:${providerIds.Tvdb}`;
    } else if (!id && providerIds.AniDb) {
        id = `anidb:${providerIds.AniDb}`;
    } else if (!id) {
        // Fallback to Emby ID if no external IDs available
        id = `emby:${embyItem.Id}`;
    }

    // Ensure IMDb IDs have 'tt' prefix
    if (id && !id.includes(':') && !id.startsWith('tt')) {
        id = `tt${id}`;
    }

    // Construct poster URL (REQUIRED field for Meta Preview Object)
    let posterUrl;
    if (embyItem.ImageTags?.Primary) {
        posterUrl = `${config.serverUrl}/Items/${embyItem.Id}/Images/Primary?api_key=${config.accessToken}`;
    } else {
        // Fallback to a transparent 1x1 pixel PNG as placeholder
        posterUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }

    // Meta Preview Object with all REQUIRED fields
    const catalogItem = {
        id: id,
        type: type,
        name: embyItem.Name || 'Unknown Title',
        poster: posterUrl  // REQUIRED field
    };

    // Add optional fields for better display
    if (embyItem.Overview) {
        catalogItem.description = embyItem.Overview;
    }

    if (embyItem.PremiereDate) {
        const year = new Date(embyItem.PremiereDate).getFullYear();
        if (!isNaN(year)) {
            catalogItem.releaseInfo = year.toString();
        }
    }

    if (embyItem.CommunityRating) {
        catalogItem.imdbRating = embyItem.CommunityRating.toFixed(1);
    }

    if (embyItem.Genres && embyItem.Genres.length > 0) {
        catalogItem.genres = embyItem.Genres;
    }

    return catalogItem;
}

module.exports = {
    getCatalogItems
};
