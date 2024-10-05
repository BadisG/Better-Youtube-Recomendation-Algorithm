// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?*
// @match        https://www.youtube.com/feed/channels
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    let Threshold = 10;
    let subscribedChannels = new Set();

    function log(...args) {
        if (DEBUG) {
            console.log('[Better YouTube]', ...args);
        }
    }

    function shouldRunOnCurrentPage() {
        const url = window.location.href;
        return url === 'https://www.youtube.com/' ||
            url.startsWith('https://www.youtube.com/watch?') ||
            url === 'https://www.youtube.com/feed/channels';
    }

    function fetchSubscribedChannels() {
        function updateSubscribedChannels() {
            const channelElements = document.querySelectorAll('yt-formatted-string#text.style-scope.ytd-channel-name');
            let newSubscribedChannels = [];

            channelElements.forEach(element => {
                const channelName = element.textContent.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (!newSubscribedChannels.includes(channelName)) {
                    newSubscribedChannels.push(channelName);
                }
            });

            GM_setValue('subscribedChannels', JSON.stringify(newSubscribedChannels));
            subscribedChannels = new Set(newSubscribedChannels);

            log('Fetched subscribed channels:', Array.from(subscribedChannels));
        }

        function waitForChannels() {
            const observer = new MutationObserver((mutations, obs) => {
                const channelList = document.querySelector('#items.style-scope.ytd-section-list-renderer');
                if (channelList) {
                    updateSubscribedChannels();
                    obs.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        waitForChannels();
        setInterval(updateSubscribedChannels, 6000);
    }

    function getVideoId(thumbnailElement) {
        if (window.location.href.includes("watch?v=")) {
            // On an individual video page
            const link = thumbnailElement.querySelector('a.yt-simple-endpoint');
            if (link) {
                const href = link.getAttribute('href');
                if (href) {
                    const match = href.match(/[?&]v=([^&]+)/);
                    return match ? match[1] : null;
                }
            }
        } else if (window.location.href === "https://www.youtube.com/") {
            // On the YouTube homepage
            const videoLink = thumbnailElement.querySelector('a[href^="/watch?v="]');
            if (videoLink) {
                const href = videoLink.getAttribute('href');
                // Extract the video ID using a regular expression
                const match = href.match(/[?&]v=([^&]+)/);
                return match ? match[1] : null;
            }
            return null;
        }
    }

    function getChannelName(thumbnailElement) {
        if (window.location.href.includes("watch?v=")) {
            // On an individual video page
            const channelNameElement = thumbnailElement.querySelector('ytd-channel-name #text-container yt-formatted-string#text');
            return channelNameElement ? channelNameElement.textContent.trim() : null;
        } else if (window.location.href === "https://www.youtube.com/") {
            // Find all anchor tags in the thumbnail element
            const possibleChannelLinks = thumbnailElement.querySelectorAll('a[href^="/@"]');
            for (const link of possibleChannelLinks) {
                // Check if the link has text content that looks like a channel name
                if (link.textContent && link.textContent.trim().length > 0) {
                    return link.textContent.trim();
                }
            }

            return null;
        }
    }


    function isLive(element) {
        const liveIndicators = [
            // Check for aria-label="LIVE"
            () => element.querySelector('[aria-label="LIVE"]'),
        ];

        return liveIndicators.some(indicator => indicator());
    }

    function hasWatchProgress(element) {
        if (window.location.href === 'https://www.youtube.com/') {
            // Logic for YouTube homepage
            const progressBar = element.querySelector('yt-thumbnail-overlay-progress-bar-view-model');
            if (progressBar) {
                const progressSegment = progressBar.querySelector('.YtThumbnailOverlayProgressBarHostWatchedProgressBarSegment');
                if (progressSegment) {
                    const width = progressSegment.style.width;
                    console.log('Progress bar found on homepage. Width:', width);
                    return width !== '' && width !== '0%';
                }
            }
            return false;
        } else if (window.location.href.startsWith('https://www.youtube.com/watch')) {
            // Logic for individual video pages
            const progressBar = element.querySelector('#overlays ytd-thumbnail-overlay-resume-playback-renderer #progress');
            if (progressBar) {
                const width = progressBar.style.width;
                console.log('Progress bar found on video page. Width:', width);
                return width !== '' && width !== '0%';
            }
            return false;
        }
    }


    function isUpcoming(thumbnailElement) {
        const upcomingBadge = thumbnailElement.querySelector('yt-thumbnail-overlay-badge-view-model .badge-shape-wiz__text');
        return upcomingBadge && upcomingBadge.textContent.trim().toUpperCase() === 'UPCOMING';
    }


    // Function to detect whether the current page is a playlist thumbnail
    function isPlaylist(thumbnailElement) {
        const playlistThumbnail = thumbnailElement.querySelector('#playlist-thumbnails');
        const playlistIcon = thumbnailElement.querySelector('ytd-thumbnail-overlay-bottom-panel-renderer yt-icon');
        const playlistText = thumbnailElement.querySelector('ytd-thumbnail-overlay-bottom-panel-renderer yt-formatted-string');

        if (playlistThumbnail || (playlistIcon && playlistText)) {
            console.log('%cYES IT\'S A PLAYLIST', 'color: green');
            return true;
        } else {
            console.log('%cNO, IT\'S NOT A PLAYLIST', 'color: red');
            return false;
        }
    }

    function hideElement(element, reason) {
        if (element) {
            element.style.display = 'none';
            element.setAttribute('data-hide-reason', reason);
        }
        log(`${reason.charAt(0).toUpperCase() + reason.slice(1)} video, hiding`);
    }

    function showElement(element) {
        if (element) {
            element.style.display = '';
            element.removeAttribute('data-hide-reason');
        }
        log('Below threshold, showing');
    }

    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage()) {
            log('Not on a target page, skipping processing');
            return;
        }
        const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');

        if (!parentElement) {
            log('No parent element found, skipping');
            return;
        }

        log('Processing thumbnail:', parentElement);

       // if (isPlaylist(parentElement)) {
           // hideElement(parentElement, 'playlist');
           // return;
       // }

        const videoId = getVideoId(parentElement);
        const channelName = getChannelName(parentElement);

        if (!videoId || !channelName) {
            log('Missing video ID or channel name, skipping');
            return;
        }

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        log('Video ID:', videoId, 'Channel:', normalizedChannelName);

        const hideReasons = [
            { condition: () => subscribedChannels.has(normalizedChannelName), reason: 'subscribed' },
            { condition: () => isLive(parentElement), reason: 'live' },
            { condition: () => isUpcoming(parentElement), reason: 'upcoming' },
            { condition: () => hasWatchProgress(parentElement), reason: 'watched' },
        ];

        for (const { condition, reason } of hideReasons) {
            if (condition()) {
                hideElement(parentElement, reason);
                return;
            }
        }

        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);

        log('View count:', viewCount);

        if (viewCount > Threshold) {
            hideElement(parentElement, 'threshold');
        } else {
            showElement(parentElement);
        }
    }

    function observeDOMChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('ytd-rich-item-renderer, ytd-compact-video-renderer')) {
                                processThumbnail(node);
                            } else {
                                node.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer').forEach(processThumbnail);
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target.id === 'progress') {
                    const thumbnailElement = mutation.target.closest('ytd-rich-item-renderer') || mutation.target.closest('ytd-compact-video-renderer');
                    if (thumbnailElement) {
                        processThumbnail(thumbnailElement);
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });
    }

    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer');
        log('Processing existing thumbnails:', thumbnails.length);
        thumbnails.forEach(processThumbnail);
    }

    function loadStoredSubscribedChannels() {
        const storedChannels = GM_getValue('subscribedChannels');
        if (storedChannels) {
            subscribedChannels = new Set(JSON.parse(storedChannels));
            log('Loaded stored subscribed channels:', Array.from(subscribedChannels));
        } else {
            log('No stored subscribed channels found');
        }
    }

    function init() {
        loadStoredSubscribedChannels();

        if (window.location.pathname === '/feed/channels') {
            log('On channels page, fetching subscribed channels');
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            log('Processing thumbnails');
            processExistingThumbnails();
            observeDOMChanges();
        } else {
            log('Not on a target page, script inactive');
        }
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    document.addEventListener('yt-navigate-finish', (event) => {
        if (event.detail && event.detail.url) {
            log('Navigation detected:', event.detail.url);
            if (event.detail.url.includes('/feed/channels')) {
                fetchSubscribedChannels();
            } else if (shouldRunOnCurrentPage()) {
                processExistingThumbnails();
            } else {
                log('Navigated to a non-target page, script inactive');
            }
        }
    });

    log('Script initialized');
})();
