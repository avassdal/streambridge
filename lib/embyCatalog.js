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
        const libraryIds = type === 'movie' ? config.movieLibraryIds : config.seriesLibraryIds;
        const totalLimit = skip + limit;
        
        const baseParams = {
            IncludeItemTypes: itemType,
            Recursive: true,
            Fields: 'ProviderIds,Overview,PremiereDate,CommunityRating,OfficialRating,Genres,Path,ParentId,DateCreated',
            SortBy: 'DateCreated',
            SortOrder: 'Descending',
            ExcludeLocationTypes: 'Virtual'
        };

        if (type === 'movie') {
            baseParams.Filters = 'IsNotFolder';
        }

        let items = [];
        if (Array.isArray(libraryIds) && libraryIds.length > 0) {
            const requests = libraryIds.map(libraryId => axios({
                method: 'get',
                url: `${config.serverUrl}/Users/${config.userId}/Items`,
                headers: { [HEADER_EMBY_TOKEN]: config.accessToken },
                params: {
                    ...baseParams,
                    ParentId: libraryId,
                    StartIndex: 0,
                    Limit: totalLimit
                },
                timeout: 15000
            }));

            const results = await Promise.allSettled(requests);
            items = results.flatMap(result => {
                if (result.status !== 'fulfilled') return [];
                return result.value?.data?.Items || [];
            });

            items.sort((a, b) => {
                const dateA = a.DateCreated ? new Date(a.DateCreated).getTime() : 0;
                const dateB = b.DateCreated ? new Date(b.DateCreated).getTime() : 0;
                return dateB - dateA;
            });

            items = items.slice(skip, skip + limit);
        } else {
            const response = await axios({
                method: 'get',
                url: `${config.serverUrl}/Users/${config.userId}/Items`,
                headers: { [HEADER_EMBY_TOKEN]: config.accessToken },
                params: {
                    ...baseParams,
                    StartIndex: skip,
                    Limit: limit
                },
                timeout: 15000
            });

            items = response.data?.Items || [];
        }
        
        // Filter to ensure we only return valid library content
        const filteredItems = items.filter(item => {
            // Must match the requested type
            if (item.Type !== itemType) return false;
            
            // Exclude items with ParentIndexNumber (this indicates it's an episode)
            if (item.ParentIndexNumber !== undefined && item.ParentIndexNumber !== null) return false;
            
            // For movies: exclude items that are part of a series (episodes misclassified as movies)
            if (type === 'movie') {
                // Exclude if it has a SeriesId or SeriesName (it's actually an episode)
                if (item.SeriesId || item.SeriesName) return false;
                // Exclude if it has a SeasonId (it's part of a TV series)
                if (item.SeasonId) return false;
                // Exclude if LocationType is not FileSystem (virtual/metadata items)
                if (item.LocationType && item.LocationType !== 'FileSystem') return false;
            }
            
            // For series: only include actual series, not episodes
            if (type === 'series') {
                // Series should not have a SeriesId (that would make it an episode)
                if (item.SeriesId) return false;
            }
            
            return true;
        });
        
        // Deduplicate by external ID (IMDb, TMDb, etc.)
        const seen = new Map();
        const dedupedItems = [];
        
        for (const item of filteredItems) {
            const providerIds = item.ProviderIds || {};
            // Create a unique key based on external IDs
            const key = providerIds.Imdb || providerIds.Tmdb || providerIds.Tvdb || item.Id;
            
            if (!seen.has(key)) {
                seen.set(key, true);
                dedupedItems.push(item);
            }
        }
        
        return dedupedItems.map(item => convertToStremioCatalogItem(item, type, config));
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
