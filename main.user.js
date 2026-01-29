// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @author       BadisG
// @version      8.4
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails. Added duration filters.
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_START_TIME = performance.now();

    // ===== CONFIGURATION SECTION =====
    const CONFIG = {
        DEBUG: false,
        THRESHOLD: 10,
        MINIMUM_VIEWS: 1000,
        MINIMUM_DURATION: null, // Example: 180 -> 3 minutes
        MAXIMUM_DURATION: null,

        BEFORE_DATE: null, // exemple: "2024-04-16"
        AFTER_DATE: null, // exemple: "2006-05-20"

        // Filter terms
        FILTERED_TITLE_TERMS: ['aaaa', 'bbbb'],
        FILTERED_CHANNEL_TERMS: ['cccc', 'dddd'],

        VIDEO_CONTAINER_SELECTORS_BY_PAGE: {
            HOME: 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer',
            WATCH: 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer, yt-lockup-view-model'
        },

        SELECTORS: {
            VIDEO_TITLE: 'h3.yt-lockup-metadata-view-model__heading-reset span.yt-core-attributed-string',
            VIDEO_TITLE_FALLBACK: 'h3 a span.yt-core-attributed-string',
            VIDEO_LINK: 'a[href*="/watch?v="]',
            METADATA_ROWS: '.yt-content-metadata-view-model__metadata-row',
            METADATA_SPANS: 'span.yt-core-attributed-string',
            CHANNEL_NAME_PRIMARY: 'ytd-channel-name yt-formatted-string#text',
            CHANNEL_NAME_METADATA: '.yt-content-metadata-view-model-wiz__metadata-row span.yt-core-attributed-string',
            CHANNEL_NAME_LINK: 'a[href^="/@"]',
            SUBSCRIPTION_GRID: 'ytd-expanded-shelf-contents-renderer #contents',
            SUBSCRIPTION_LIST: 'ytd-section-list-renderer #items',
            SUBSCRIPTION_CHANNELS: 'ytd-channel-renderer',
            SUBSCRIPTION_NAMES: 'ytd-channel-name yt-formatted-string#text',
            PLAYLIST_INDICATORS: 'ytd-compact-playlist-renderer, ytd-item-section-renderer',
            LIVE_BADGES: '[aria-label="LIVE"], .badge-style-type-live-now-alternate, badge-shape.badge-shape-wiz--live, .yt-badge-shape-wiz__text[aria-label="LIVE"]',
            PROGRESS_BARS: '#progress, [class*="progress" i], yt-thumbnail-overlay-progress-bar-view-model, [class*="WatchedProgress"]',
            WATCH_CONTAINER: 'ytd-watch-flexy',
            SIDEBAR_RECOMMENDATIONS: 'ytd-compact-video-renderer',
            YT_LOCKUP_CONTENT_TYPE: '[ytb-content-type]',
            DURATION_BADGE: '.yt-badge-shape__text',
        }
    };

    // ===== SCRIPT VARIABLES =====
    const DEBUG = CONFIG.DEBUG;
    let Threshold = CONFIG.THRESHOLD;
    const MINIMUM_VIEWS = CONFIG.MINIMUM_VIEWS;
    let subscribedChannels = new Set();
    let currentObserver = null;
    const FILTERED_TITLE_TERMS = CONFIG.FILTERED_TITLE_TERMS;
    const FILTERED_CHANNEL_TERMS = CONFIG.FILTERED_CHANNEL_TERMS;

    // Track CSS state - IMPORTANT: Don't remove CSS, just update if needed
    let cssInjectedForPage = null; // Track which page type CSS was injected for

    // ===== UTILITY FUNCTIONS =====
    function debugLog(...args) {
        if (DEBUG) {
            console.log(...args);
        }
    }

    function timingLog(message, color = '#FF6600') {
        if (DEBUG) {
            const elapsed = performance.now() - SCRIPT_START_TIME;
            console.log(`%c[TIMING +${elapsed.toFixed(2)}ms] ${message}`, `color: ${color}; font-weight: bold;`);
        }
    }

    function logHiding(reason, title) {
        debugLog(`%c❌ HIDING - ${reason}: "${title}"`, 'color: #C03030; font-weight: bold;');
    }

    function logShowing(reason, title) {
        debugLog(`%c✅ SHOWING - ${reason}: "${title}"`, 'color: #30C030; font-weight: bold;');
    }

    function getVideoContainerSelectors() {
        const pathname = window.location.pathname;
        if (pathname === '/watch') {
            return CONFIG.VIDEO_CONTAINER_SELECTORS_BY_PAGE.WATCH;
        }
        return CONFIG.VIDEO_CONTAINER_SELECTORS_BY_PAGE.HOME;
    }

    function getCurrentPageType() {
        const pathname = window.location.pathname;
        if (pathname === '/') return 'HOME';
        if (pathname === '/watch') return 'WATCH';
        if (pathname === '/feed/channels') return 'CHANNELS';
        return 'OTHER';
    }

    // ===== MAIN FUNCTIONS =====

    function shouldRunOnCurrentPage() {
        const pathname = window.location.pathname;
        return pathname === '/' ||
            pathname === '/watch' ||
            pathname === '/feed/channels';
    }

    function fetchSubscribedChannels() {
        function updateSubscribedChannels() {
            debugLog('Starting to fetch subscribed channels by scrolling...');
            let lastHeight = 0;
            let newSubscribedNames = new Set();
            let consecutiveStops = 0;
            let scrollCount = 0;
            const maxStops = 5;
            const maxScrolls = 50;

            const scrollInterval = setInterval(() => {
                scrollCount++;
                window.scrollTo(0, document.documentElement.scrollHeight);
                const currentHeight = document.documentElement.scrollHeight;

                const channelNameElements = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_NAMES);
                debugLog(`Scroll ${scrollCount}: Found ${channelNameElements.length} channel names, height: ${currentHeight}`);

                channelNameElements.forEach(nameElement => {
                    const channelName = nameElement.textContent.trim();
                    if (channelName && channelName.length > 0) {
                        const normalizedName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (!newSubscribedNames.has(normalizedName)) {
                            newSubscribedNames.add(normalizedName);
                            debugLog(`Added channel name: ${channelName} (normalized: ${normalizedName})`);
                        }
                    }
                });

                if (currentHeight === lastHeight) {
                    consecutiveStops++;
                    if (consecutiveStops >= maxStops || scrollCount >= maxScrolls) {
                        clearInterval(scrollInterval);
                        debugLog('Finished scrolling. Final collection...');

                        setTimeout(() => {
                            const finalChannelNameElements = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_NAMES);
                            finalChannelNameElements.forEach(nameElement => {
                                const channelName = nameElement.textContent.trim();
                                if (channelName && channelName.length > 0) {
                                    const normalizedName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                    newSubscribedNames.add(normalizedName);
                                }
                            });

                            if (newSubscribedNames.size > 0) {
                                GM_setValue('subscribedChannelNames', JSON.stringify(Array.from(newSubscribedNames)));
                                subscribedChannels = newSubscribedNames;
                                debugLog('Successfully saved subscribed channel names:', Array.from(newSubscribedNames));
                                debugLog('Total subscribed channel names found:', subscribedChannels.size);

                                GM_setValue('subscribedChannelHandles', JSON.stringify([]));
                                GM_setValue('subscribedChannels', JSON.stringify([]));
                            } else {
                                debugLog('Could not find any channel names after scrolling.');
                            }
                        }, 1000);
                    }
                } else {
                    lastHeight = currentHeight;
                    consecutiveStops = 0;
                }

                if (scrollCount >= maxScrolls) {
                    clearInterval(scrollInterval);
                    debugLog('Reached maximum scroll limit');
                }
            }, 2000);
        }

        const observer = new MutationObserver((mutations, obs) => {
            const gridContainer = document.querySelector(CONFIG.SELECTORS.SUBSCRIPTION_GRID);
            const listContainer = document.querySelector(CONFIG.SELECTORS.SUBSCRIPTION_LIST);
            const channelRenderers = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_CHANNELS);

            if ((gridContainer || listContainer) && channelRenderers.length > 0) {
                debugLog('Subscription page content detected with channels. Starting fetch...');
                obs.disconnect();
                setTimeout(updateSubscribedChannels, 2000);
            } else if (channelRenderers.length > 5) {
                debugLog('Multiple channel renderers detected. Starting fetch...');
                obs.disconnect();
                setTimeout(updateSubscribedChannels, 1000);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            const channelRenderers = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_CHANNELS);
            if (channelRenderers.length > 0) {
                debugLog('Timeout reached, but found channels. Starting fetch anyway...');
                updateSubscribedChannels();
            } else {
                debugLog('Timeout reached and no channels found. Make sure you are on the subscriptions page.');
            }
        }, 10000);
    }

    function getChannelName(thumbnailElement) {
        const selectors = [
            CONFIG.SELECTORS.CHANNEL_NAME_PRIMARY,
            CONFIG.SELECTORS.CHANNEL_NAME_METADATA,
            CONFIG.SELECTORS.CHANNEL_NAME_LINK
        ];

        for (const selector of selectors) {
            const element = thumbnailElement.querySelector(selector);
            if (element && element.textContent && element.textContent.trim().length > 0) {
                return element.textContent.trim();
            }
        }
        return null;
    }

    function isNormalVideo(element) {
        if (element.tagName.toUpperCase() === 'YT-LOCKUP-VIEW-MODEL') {
            const contentType = element.getAttribute('ytb-content-type');
            if (contentType === 'playlist' || contentType === 'channel') {
                return { isNormal: false, reason: `yt-lockup-view-model is a ${contentType}` };
            }
        }
    
        if (element.matches(CONFIG.SELECTORS.PLAYLIST_INDICATORS)) {
            return { isNormal: false, reason: 'Playlist element detected' };
        }
    
        const hasLiveBadge = element.querySelector(CONFIG.SELECTORS.LIVE_BADGES);
        if (hasLiveBadge) {
            return { isNormal: false, reason: 'Live stream detected' };
        }
    
        // More comprehensive progress bar detection
        const hasProgressBar = element.querySelector(CONFIG.SELECTORS.PROGRESS_BARS);
        
        // Additional check: look for the progress bar with visible width
        const progressBarElement = element.querySelector('yt-thumbnail-overlay-progress-bar-view-model');
        if (progressBarElement) {
            const progressSegment = progressBarElement.querySelector('.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment');
            if (progressSegment) {
                const width = progressSegment.style.width;
                if (width && parseFloat(width) > 0) {
                    return { isNormal: false, reason: `Already watched (${width} progress)` };
                }
            }
        }
        
        if (hasProgressBar) {
            return { isNormal: false, reason: 'Already watched' };
        }
    
        return { isNormal: true, reason: 'Normal video' };
    }

    function hideElement(element, reason) {
        if (element) {
            element.setAttribute('data-hide-reason', reason);
            element.setAttribute('data-processed', 'hide');
            element.style.display = 'none !important';
        }
    }

    function showElement(element) {
        if (element) {
            element.removeAttribute('data-hide-reason');
            element.setAttribute('data-processed', 'show');
            element.style.display = '';
        }
    }

    function shouldProcessElement(element) {
        const isHomePage = window.location.pathname === '/';
        const isWatchPage = window.location.pathname === '/watch';

        if (isHomePage) {
            return element.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                element.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                element.tagName === 'YT-LOCKUP-VIEW-MODEL';
        } else if (isWatchPage) {
            const tagName = element.tagName.toUpperCase();
            return tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                tagName === 'YT-LOCKUP-VIEW-MODEL';
        }

        return false;
    }

    function getVideoId(element) {
        if (!element) return null;

        const link = element.querySelector(CONFIG.SELECTORS.VIDEO_LINK);
        if (link && link.href) {
            try {
                const url = new URL(link.href);
                return url.searchParams.get('v');
            } catch (e) {
                const match = link.href.match(/[?&]v=([^&]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }
        return null;
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage() || !shouldProcessElement(thumbnailElement)) {
            return;
        }

        let parentElement = thumbnailElement.matches(getVideoContainerSelectors()) ?
            thumbnailElement :
        thumbnailElement.closest(getVideoContainerSelectors());

        if (!parentElement) return;

        if (parentElement.hasAttribute('data-hide-reason')) {
            return;
        }

        const videoId = getVideoId(parentElement);

        let videoTitleElement = parentElement.querySelector(CONFIG.SELECTORS.VIDEO_TITLE);
        if (!videoTitleElement) {
            videoTitleElement = parentElement.querySelector(CONFIG.SELECTORS.VIDEO_TITLE_FALLBACK);
        }

        const videoTitle = videoTitleElement ? videoTitleElement.textContent.trim() : 'Unknown Title';

        if (videoTitle === 'Unknown Title') {
            hideElement(parentElement, 'Is an Ad or placeholder element');
            return;
        }

        debugLog(`%cProcessing: "${videoTitle}"`, 'font-weight: bold');

        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            logHiding(normalVideoCheck.reason, videoTitle);
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return;
        }

        // Check filtered terms - only if there are actual terms to filter
        for (const term of FILTERED_TITLE_TERMS) {
            if (term.length === 0) continue; // Skip empty strings
            const escapedTerm = escapeRegExp(term);
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`, 'iu');

            if (regex.test(videoTitle)) {
                logHiding(`Found "${term}" in title`, videoTitle);
                hideElement(parentElement, `Filtered title term: ${term}`);
                return;
            }
        }

        let channelName = null;
        const metadataRows = parentElement.querySelectorAll(CONFIG.SELECTORS.METADATA_ROWS);

        for (const row of metadataRows) {
            const channelSpan = row.querySelector(CONFIG.SELECTORS.METADATA_SPANS);
            if (channelSpan) {
                const text = channelSpan.textContent.trim();
                if (!text.includes('view') && !text.includes('ago') && !text.includes('•') && text.length > 0) {
                    channelName = text;
                    break;
                }
            }
        }

        if (!channelName) {
            channelName = getChannelName(parentElement);
        }

        if (!videoId || !channelName) {
            logHiding('Missing video ID or channel name', videoTitle);
            hideElement(parentElement, 'Missing video ID or channel name');
            return;
        }

        debugLog(`   Found - Channel: "${channelName}", Video ID: "${videoId}"`);

        // Check filtered channel terms - only if there are actual terms to filter
        for (const term of FILTERED_CHANNEL_TERMS) {
            if (term.length === 0) continue; // Skip empty strings
            const escapedTerm = escapeRegExp(term);
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`, 'iu');
            if (regex.test(channelName)) {
                logHiding(`Found "${term}" in channel name: "${channelName}"`, videoTitle);
                hideElement(parentElement, `Filtered channel term: ${term}`);
                return;
            }
        }

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isSubscribed = subscribedChannels.has(normalizedChannelName);

        if (isSubscribed) {
            logHiding(`Subscribed channel: "${channelName}"`, videoTitle);
            hideElement(parentElement, `Subscribed channel: ${channelName}`);
            return;
        }

        let viewCountText = null;
        let metadataDate = null;

        for (const row of metadataRows) {
            const spans = row.querySelectorAll(CONFIG.SELECTORS.METADATA_SPANS);
            for (const span of spans) {
                const text = span.textContent.trim().toLowerCase();
                if (text.includes('view') && !viewCountText) {
                    viewCountText = text;
                } else if (text.match(/^(streamed\s+)?\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i) && !metadataDate) {
                    metadataDate = text;
                }
            }
        }

        if (!viewCountText || !metadataDate) {
            logHiding('No view count or date metadata found', videoTitle);
            hideElement(parentElement, 'No view count or date metadata found');
            return;
        }

        const numericViews = parseViewCount(viewCountText);
        debugLog(`   Channel: ${channelName}, Views: ${viewCountText} (${numericViews.toLocaleString()}), Date: ${metadataDate}`);

        const videoDate = parseDateFromMetadata(metadataDate);
        if (videoDate) {
            let afterDate = CONFIG.AFTER_DATE ? new Date(CONFIG.AFTER_DATE) : null;
            let beforeDate = CONFIG.BEFORE_DATE ? new Date(CONFIG.BEFORE_DATE) : null;

            if (afterDate && videoDate < afterDate) {
                logHiding(`Video before AFTER_DATE (${metadataDate})`, videoTitle);
                hideElement(parentElement, `Before AFTER_DATE`);
                return;
            }
            if (beforeDate && videoDate > beforeDate) {
                logHiding(`Video after BEFORE_DATE (${metadataDate})`, videoTitle);
                hideElement(parentElement, `After BEFORE_DATE`);
                return;
            }
        }

        if (numericViews < MINIMUM_VIEWS) {
            logHiding(`Below minimum views: ${viewCountText}`, videoTitle);
            hideElement(parentElement, `Below minimum views: ${viewCountText}`);
            return;
        }

        // Check video duration (skip for music videos)
        const durationBadge = parentElement.querySelector(CONFIG.SELECTORS.DURATION_BADGE);
        if (durationBadge) {
            const durationText = durationBadge.textContent.trim();
            const durationSeconds = parseDuration(durationText);
            
            // Check if this is a music video by looking for the music icon
            const badgeShape = durationBadge.closest('badge-shape');
            const hasMusicIcon = badgeShape && badgeShape.querySelector('.yt-badge-shape__icon');
            
            if (hasMusicIcon) {
                debugLog(`   Music video detected (has music icon), skipping duration filter`);
            } else {
                debugLog(`   Duration: ${durationText} (${durationSeconds} seconds)`);
        
                if (durationSeconds > 0) {
                    if (CONFIG.MINIMUM_DURATION && durationSeconds < CONFIG.MINIMUM_DURATION) {
                        logHiding(`Below minimum duration: ${durationText} (${durationSeconds}s < ${CONFIG.MINIMUM_DURATION}s)`, videoTitle);
                        hideElement(parentElement, `Below minimum duration: ${durationText}`);
                        return;
                    }
        
                    if (CONFIG.MAXIMUM_DURATION && durationSeconds > CONFIG.MAXIMUM_DURATION) {
                        logHiding(`Above maximum duration: ${durationText} (${durationSeconds}s > ${CONFIG.MAXIMUM_DURATION}s)`, videoTitle);
                        hideElement(parentElement, `Above maximum duration: ${durationText}`);
                        return;
                    }
                }
            }
        }

        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);
        debugLog(`View count: ${viewCount}/${Threshold}`);

        if (viewCount > Threshold) {
            logHiding(`Over threshold (${viewCount}/${Threshold})`, videoTitle);
            hideElement(parentElement, 'Over threshold');
        } else {
            logShowing(`Below threshold (${viewCount}/${Threshold})`, videoTitle);
            showElement(parentElement);
        }
    }

    function hideShortsShelf() {
        const pathname = window.location.pathname;
        const isHomePage = pathname === '/';
        const isWatchPage = pathname === '/watch';

        if (!isHomePage && !isWatchPage) {
            return;
        }

        if (isHomePage) {
            const shelves = document.querySelectorAll('ytd-rich-shelf-renderer');
            shelves.forEach(shelf => {
                const titleElement = shelf.querySelector('#title.style-scope.ytd-rich-shelf-renderer');
                if (titleElement && titleElement.textContent.trim() === 'Shorts') {
                    debugLog('Hiding Shorts shelf on homepage.');
                    shelf.style.display = 'none';
                }
            });
        }

        if (isWatchPage) {
            const reelShelves = document.querySelectorAll('ytd-reel-shelf-renderer');
            reelShelves.forEach(shelf => {
                debugLog('Hiding Shorts reel shelf on watch page.');
                shelf.style.display = 'none';
            });
        }
    }

    function observeDOMChanges() {
        timingLog('observeDOMChanges called', '#0066FF');

        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }

        currentObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                hideShortsShelf();
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches && node.matches(getVideoContainerSelectors())) {
                                processThumbnail(node);
                            } else if (node.querySelectorAll) {
                                node.querySelectorAll(getVideoContainerSelectors()).forEach(processThumbnail);
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target.id === 'progress') {
                    const thumbnailElement = mutation.target.closest(getVideoContainerSelectors());
                    if (thumbnailElement) {
                        processThumbnail(thumbnailElement);
                    }
                }
            });
        });

        currentObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });

        timingLog('MutationObserver started', '#0066FF');
    }

    function processExistingThumbnails() {
        timingLog('processExistingThumbnails called', '#FF00FF');

        const thumbnails = document.querySelectorAll(getVideoContainerSelectors());
        debugLog('Processing existing thumbnails:', thumbnails.length);
        thumbnails.forEach(processThumbnail);
    }

    function processPageWithRetry(maxRetries = 3, delay = 500) {
        timingLog(`processPageWithRetry called (maxRetries=${maxRetries}, delay=${delay})`, '#FF00FF');
        let retryCount = 0;

        function attemptProcess() {
            const thumbnails = document.querySelectorAll(getVideoContainerSelectors());
            timingLog(`Retry attempt ${retryCount + 1}: Found ${thumbnails.length} thumbnails`, '#FF00FF');

            if (thumbnails.length > 0 || retryCount >= maxRetries) {
                processExistingThumbnails();
                observeDOMChanges();
            } else {
                retryCount++;
                setTimeout(attemptProcess, delay);
            }
        }

        attemptProcess();
    }

    function loadStoredSubscribedChannels() {
        const storedNames = GM_getValue('subscribedChannelNames');
        if (storedNames && storedNames.length > 2) {
            subscribedChannels = new Set(JSON.parse(storedNames));
            debugLog('Loaded stored subscribed channel names:', Array.from(subscribedChannels));
        } else {
            debugLog('No stored subscribed channel names found. Please visit your subscriptions page (youtube.com/feed/channels) to generate the list.');
        }
    }

    function parseDateFromMetadata(metadataText) {
        const now = new Date();
        const match = metadataText.match(/^(Streamed\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);

        if (match) {
            const value = parseInt(match[2], 10);
            const unit = match[3];

            switch (unit) {
                case 'second':
                    return new Date(now - value * 1000);
                case 'minute':
                    return new Date(now - value * 60000);
                case 'hour':
                    return new Date(now - value * 3600000);
                case 'day':
                    return new Date(now - value * 86400000);
                case 'week':
                    return new Date(now - value * 7 * 86400000);
                case 'month':
                    return new Date(now.setMonth(now.getMonth() - value));
                case 'year':
                    return new Date(now.setFullYear(now.getFullYear() - value));
            }
        }
        console.error('Unrecognized date format (not a date):', metadataText);
        return null;
    }

    function parseViewCount(viewText) {
        const lowerViewText = viewText.toLowerCase();
        let match = lowerViewText.match(/([\d,.]+)\s*([kmb])/);
        if (match) {
            const num = parseFloat(match[1].replace(/,/g, ''));
            const unit = match[2];
            let multiplier = 1;
            switch (unit) {
                case 'k': multiplier = 1_000; break;
                case 'm': multiplier = 1_000_000; break;
                case 'b': multiplier = 1_000_000_000; break;
            }
            return isNaN(num) ? 0 : num * multiplier;
        } else {
            const numericValueMatch = lowerViewText.match(/(\d[\d,.]*)/);
            if (numericValueMatch && numericValueMatch[1]) {
                const num = parseFloat(numericValueMatch[1].replace(/,/g, ''));
                return isNaN(num) ? 0 : num;
            }
        }
        return 0;
    }

    function parseDuration(durationText) {
        if (!durationText) return 0;

        const parts = durationText.trim().split(':').map(p => parseInt(p, 10));

        if (parts.length === 3) {
            // Format: HH:MM:SS (e.g., "1:41:13")
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            // Format: MM:SS (e.g., "5:14")
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
            // Format: SS (e.g., "45")
            return parts[0];
        }

        return 0;
    }

    function getHidingCSS(selectors) {
        return `
    /* Hide all video containers by default until processed */
    ${selectors} {
        visibility: hidden !important;
        opacity: 0 !important;
    }

    /* Show processed videos that passed the filter */
    ${selectors}[data-processed="show"] {
        visibility: visible !important;
        opacity: 1 !important;
    }

    /* Keep hidden videos hidden */
    [data-hide-reason] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        overflow: hidden !important;
        position: absolute !important;
        left: -9999px !important;
        top: -9999px !important;
        pointer-events: none !important;
    }

    /* Specific targeting for yt-lockup-view-model elements */
    yt-lockup-view-model[data-hide-reason] {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
    }
`;
    }

    function ensureCSS() {
        const pageType = getCurrentPageType();

        // Don't inject CSS for non-target pages
        if (pageType === 'CHANNELS' || pageType === 'OTHER') {
            return;
        }

        const selectors = getVideoContainerSelectors();
        const existingStyle = document.getElementById('youtube-filter-css');

        if (existingStyle) {
            // CSS already exists - check if it needs updating for different page type
            if (cssInjectedForPage !== pageType) {
                // Update the CSS content without removing the element
                existingStyle.textContent = getHidingCSS(selectors);
                cssInjectedForPage = pageType;
                timingLog(`CSS updated for page type: ${pageType}`, '#00CCCC');
            }
            // Otherwise, CSS is already correct, do nothing
            return;
        }

        // No CSS exists yet, create it
        const targetElement = document.head || document.documentElement;
        if (!targetElement) {
            timingLog('WARNING: No target element for CSS injection!', '#FF0000');
            return;
        }

        const style = document.createElement('style');
        style.id = 'youtube-filter-css';
        style.textContent = getHidingCSS(selectors);
        targetElement.appendChild(style);
        cssInjectedForPage = pageType;
        timingLog(`CSS injected for page type: ${pageType}`, '#00CCCC');
    }

    function removeCSS() {
        const existingStyle = document.getElementById('youtube-filter-css');
        if (existingStyle) {
            existingStyle.remove();
            cssInjectedForPage = null;
            timingLog('CSS removed - not on target page', '#00CCCC');
        }
    }

    // ===== EARLY CSS INJECTION =====
    // Inject CSS as early as possible, before any content loads
    function injectEarlyCSS() {
        timingLog('injectEarlyCSS called', '#FFCC00');

        // Use broad selectors that cover both HOME and WATCH pages
        const broadSelectors = 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer, yt-lockup-view-model';

        const css = `
    /* EARLY HIDE: Hide all video containers by default */
    ${broadSelectors} {
        visibility: hidden !important;
        opacity: 0 !important;
    }

    /* Show processed videos that passed the filter */
    ${broadSelectors}[data-processed="show"] {
        visibility: visible !important;
        opacity: 1 !important;
    }

    /* Keep hidden videos hidden */
    [data-hide-reason] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        overflow: hidden !important;
        position: absolute !important;
        left: -9999px !important;
        top: -9999px !important;
        pointer-events: none !important;
    }

    yt-lockup-view-model[data-hide-reason] {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
    }
`;

        // Try to inject into head first
        if (document.head) {
            const style = document.createElement('style');
            style.id = 'youtube-filter-css';
            style.textContent = css;
            document.head.appendChild(style);
            cssInjectedForPage = 'EARLY';
            timingLog('Early CSS injected into head', '#FFCC00');
            return;
        }

        // If head doesn't exist, inject into documentElement
        if (document.documentElement) {
            const style = document.createElement('style');
            style.id = 'youtube-filter-css';
            style.textContent = css;
            document.documentElement.appendChild(style);
            cssInjectedForPage = 'EARLY';
            timingLog('Early CSS injected into documentElement', '#FFCC00');

            // Move to head when it becomes available
            const headObserver = new MutationObserver((mutations, obs) => {
                if (document.head && !document.head.contains(style)) {
                    document.head.appendChild(style);
                    timingLog('Moved CSS from documentElement to head', '#FFCC00');
                    obs.disconnect();
                }
            });
            headObserver.observe(document.documentElement, { childList: true, subtree: true });
            return;
        }

        timingLog('WARNING: Cannot inject early CSS - no target element', '#FF0000');
    }

    function monitorHiddenElements() {
        setInterval(() => {
            const hiddenElements = document.querySelectorAll('[data-hide-reason]');
            hiddenElements.forEach(element => {
                if (window.getComputedStyle(element).display !== 'none') {
                    const reason = element.getAttribute('data-hide-reason');
                    debugLog(`Force re-hiding element that reappeared: ${reason}`);
                }
            });
        }, 1000);
    }

    function convertLiveUrlToWatchUrl(url) {
        const liveMatch = url.match(/\/live\/([^?]+)/);
        if (liveMatch) {
            const videoId = liveMatch[1];
            let newUrl = `https://www.youtube.com/watch?v=${videoId}`;

            const timeMatch = url.match(/[?&]t=(\d+)/);
            if (timeMatch) {
                newUrl += `&t=${timeMatch[1]}s`;
            }

            return newUrl;
        }
        return url;
    }

    function convertCurrentUrl() {
        const currentUrl = window.location.href;
        if (currentUrl.includes('/live/')) {
            const newUrl = convertLiveUrlToWatchUrl(currentUrl);
            if (newUrl !== currentUrl) {
                debugLog('Converting live URL to watch URL:', newUrl);
                window.history.replaceState({}, '', newUrl);
            }
        }
    }

    function init() {
        timingLog('init() called', '#00FF00');

        loadStoredSubscribedChannels();
        monitorHiddenElements();
        convertCurrentUrl();

        if (window.location.pathname === '/feed/channels') {
            debugLog('On channels page, fetching subscribed channels');
            removeCSS();
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            debugLog('Processing thumbnails');
            ensureCSS(); // Use ensureCSS instead of injectCSS
            processPageWithRetry();
        } else {
            debugLog('Not on a target page, script inactive');
            removeCSS();
        }
    }

    // ===== IMMEDIATE EARLY CSS INJECTION =====
    // This runs IMMEDIATELY when the script executes
    injectEarlyCSS();

    // ===== EVENT LISTENERS =====

    document.addEventListener('yt-navigate-finish', (event) => {
        const currentUrl = event.detail?.url || window.location.href;
        timingLog(`yt-navigate-finish event fired, URL: ${currentUrl}`, '#FF6600');

        convertCurrentUrl();

        if (currentUrl.includes('/feed/channels')) {
            removeCSS();
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            ensureCSS(); // Use ensureCSS - will update if needed, won't flash
            setTimeout(() => {
                debugLog('Starting post-navigation processing...');
                processPageWithRetry(8, 500);
            }, 100); // Reduced delay since CSS is already in place
        } else {
            removeCSS();
            debugLog('Navigated to a non-target page, script inactive');
            if (currentObserver) {
                currentObserver.disconnect();
                currentObserver = null;
            }
        }
    });

    document.addEventListener('yt-navigate-start', () => {
        timingLog('yt-navigate-start event fired', '#FF6600');
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }
    });

    const ytAppObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'video-id' || mutation.attributeName === 'active')) {
                debugLog('YouTube app state changed');
                if (shouldRunOnCurrentPage()) {
                    setTimeout(() => processExistingThumbnails(), 100);
                }
            }
        }
    });

    // Wait for ytd-app to exist before observing
    function observeYtApp() {
        const ytApp = document.querySelector('ytd-app');
        if (ytApp) {
            ytAppObserver.observe(ytApp, {
                attributes: true,
                attributeFilter: ['video-id', 'active']
            });
        } else {
            // Retry if ytd-app doesn't exist yet
            setTimeout(observeYtApp, 100);
        }
    }

    timingLog(`Document readyState: ${document.readyState}`, '#888888');

    if (document.readyState === 'complete') {
        timingLog('Document already complete, calling init()', '#00FF00');
        init();
        observeYtApp();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            timingLog('DOMContentLoaded event fired', '#00FF00');
            observeYtApp();
        });

        window.addEventListener('load', () => {
            timingLog('window load event fired', '#00FF00');
            init();
        });
    }

    timingLog('Script setup complete', '#888888');
})();
