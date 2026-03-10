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
        return items.map(item => convertToStremioCatalogItem(item, type));
    } catch (err) {
        console.error('Error fetching catalog items:', err.message);
        return [];
    }
}

/**
 * Converts an Emby item to Stremio catalog format
 * @param {object} embyItem - Emby item object
 * @param {string} type - 'movie' or 'series'
 * @returns {object} Stremio catalog item
 */
function convertToStremioCatalogItem(embyItem, type) {
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

    const catalogItem = {
        id: id,
        type: type,
        name: embyItem.Name || 'Unknown Title'
    };

    // Add poster if available
    if (embyItem.ImageTags?.Primary) {
        catalogItem.poster = `${embyItem.ServerId || 'server'}/Items/${embyItem.Id}/Images/Primary`;
    }

    // Add description
    if (embyItem.Overview) {
        catalogItem.description = embyItem.Overview;
    }

    // Add release info
    if (embyItem.PremiereDate) {
        const year = new Date(embyItem.PremiereDate).getFullYear();
        if (!isNaN(year)) {
            catalogItem.releaseInfo = year.toString();
        }
    }

    // Add rating
    if (embyItem.CommunityRating) {
        catalogItem.imdbRating = embyItem.CommunityRating.toFixed(1);
    }

    // Add genres
    if (embyItem.Genres && embyItem.Genres.length > 0) {
        catalogItem.genres = embyItem.Genres;
    }

    return catalogItem;
}

module.exports = {
    getCatalogItems
};
