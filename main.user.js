// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Count and hide YouTube thumbnails after 5 views, excluding subscribed channels, and hide playlist, live, and fully watched thumbnails.
// @match        https://www.youtube.com/*
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
        setInterval(updateSubscribedChannels, 60000);
    }

    function getVideoId(thumbnailElement) {
        const link = thumbnailElement.querySelector('a#thumbnail') || thumbnailElement.querySelector('a.yt-simple-endpoint');
        if (link) {
            const href = link.getAttribute('href');
            if (href) {
                const match = href.match(/[?&]v=([^&]+)/);
                return match ? match[1] : null;
            }
        }
        return null;
    }

    function getChannelName(thumbnailElement) {
        const channelNameElement =
            thumbnailElement.querySelector('ytd-channel-name #text-container yt-formatted-string#text') ||
            thumbnailElement.querySelector('#text');
        return channelNameElement ? channelNameElement.textContent.trim() : null;
    }

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
        const progressBar = element.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress');
        return progressBar !== null && progressBar.style.width !== '0%';
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
                }
                return;
            }

            if (isPlaylist(thumbnailElement) || isLive(thumbnailElement) || hasWatchProgress(thumbnailElement)) {
                log('Playlist, live, or watched video, hiding');
                if (parentElement) {
                    parentElement.style.display = 'none';
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
                }
            } else {
                log('Below threshold, showing');
                if (parentElement) {
                    parentElement.style.display = '';
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
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-grid-media, ytd-compact-video-renderer');
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
