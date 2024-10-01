// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      2.0
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
            const link = thumbnailElement.querySelector('a.yt-lockup-metadata-view-model-wiz__title');
            if (link) {
                const href = link.getAttribute('href');
                if (href) {
                    const match = href.match(/[?&]v=([^&]+)/);
                    return match ? match[1] : null;
                }
            }
        }
        return null;
    }

    function getChannelName(thumbnailElement) {
        if (window.location.href.includes("watch?v=")) {
            // On an individual video page
            const channelNameElement = thumbnailElement.querySelector('ytd-channel-name #text-container yt-formatted-string#text');
            return channelNameElement ? channelNameElement.textContent.trim() : null;
        } else if (window.location.href === "https://www.youtube.com/") {
            // On the YouTube homepage
            const channelNameElement = thumbnailElement.querySelector('yt-lockup-metadata-view-model yt-content-metadata-view-model .yt-core-attributed-string__link');
            return channelNameElement ? channelNameElement.textContent.trim() : null;
        }
        return null;
    }


    // Function to detect whether the current page is a playlist thumbnail
    function isPlaylist(thumbnailElement) {
        const playlistLabel = thumbnailElement.querySelector('ytd-thumbnail-overlay-bottom-panel-renderer yt-formatted-string');
        if (playlistLabel) {
            const labelText = playlistLabel.textContent.trim().toLowerCase();
            return /\d+\s+videos/.test(labelText) || labelText === 'mix';
        }
        return false;
    }


    function isLive(thumbnailElement) {
        const liveBadge = thumbnailElement.querySelector('ytd-badge-supported-renderer .badge-style-type-live-now-alternate');
        return !!liveBadge;
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
        const upcomingBadge = thumbnailElement.querySelector('.thumbnail-overlay-badge-shape .badge-shape-wiz__text');
        return upcomingBadge && upcomingBadge.textContent === 'UPCOMING';
    }

    function processThumbnail(thumbnailElement) {
        const videoId = getVideoId(thumbnailElement);
        const channelName = getChannelName(thumbnailElement);

        if (videoId && channelName) {
            const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');
            const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            log('Processing thumbnail:', videoId, normalizedChannelName);

            if (subscribedChannels.has(normalizedChannelName)) {
                log('Subscribed channel, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'subscribed');
                }
                return;
            }

            if (isPlaylist(thumbnailElement)) {
                log('Playlist video, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'playlist');
                }
                return;
            }

            if (isLive(thumbnailElement)) {
                log('Live video, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'live');
                }
                return;
            }

            if (isUpcoming(thumbnailElement)) {
                log('Upcoming video, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'upcoming');
                }
                return;
            }

            // Check if the video has been watched first
            if (hasWatchProgress(thumbnailElement)) {
                log('Watched video, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'watched');
                }
                return;
            }

            let viewCount = GM_getValue(videoId, 0);
            viewCount++;
            GM_setValue(videoId, viewCount);

            log('View count:', viewCount);

            if (viewCount > Threshold) {
                log('Exceeded threshold, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
                    parentElement.setAttribute('data-hide-reason', 'threshold');
                }
            } else {
                log('Below threshold, showing');
                if (parentElement) {
                    parentElement.style.display = '';
                    parentElement.removeAttribute('data-hide-reason');
                }
            }
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
        } else {
            log('Processing thumbnails');
            processExistingThumbnails();
            observeDOMChanges();
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
            } else {
                processExistingThumbnails();
            }
        }
    });

    log('Script initialized');
})();
