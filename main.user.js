// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Count and hide YouTube thumbnails after 5 views, excluding subscribed channels, and hide playlist, live, and fully watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?v=*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    let Threshold = 10;
    let subscribedChannels = new Set();
    let guideProcessing = false; // Flag to prevent multiple executions

    function updateSubscribedChannels(allSubscriptions) {
        subscribedChannels = new Set(
            Array.from(allSubscriptions).map((el) =>
                el.title.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            )
        );
        console.log('Updated Subscribed Channels:', Array.from(subscribedChannels));
    }

    function setGuideTransparency(transparent) {
        const guideContainer = document.querySelector('#contentContainer');
        const scrim = document.querySelector('#scrim');

        if (guideContainer && window.location.pathname.includes('/watch')) {
            guideContainer.style.transition = 'opacity 0s';
            guideContainer.style.opacity = transparent ? '0' : '1';
        }

        if (scrim && window.location.pathname.includes('/watch')) {
            scrim.style.transition = 'opacity 0s';
            scrim.style.opacity = transparent ? '0' : '1';
        }
    }


    function loadSubscribedChannels() {
        if (guideProcessing) return; // Prevent re-entrance
        guideProcessing = true; // Set the flag

        return new Promise((resolve) => {
            function printAllSubscriptions(allSubscriptions) {
                console.log('List of all subscribed channels:');
                updateSubscribedChannels(allSubscriptions);
                closeGuide();
                setGuideTransparency(false);
                guideProcessing = false; // Reset the flag
                resolve();
            }

            function openGuide() {
                console.log('%cOpening guide...', 'color: red;');
                const guideButton = document.querySelector('#guide-button');
                if (guideButton) {
                    const isOpen = guideButton.getAttribute('aria-pressed') === 'true';
                    if (!isOpen) {
                        setGuideTransparency(true);
                        guideButton.click();
                    }
                    setTimeout(clickSubscriptionsButton, 1000);
                } else {
                    setTimeout(openGuide, 1000);
                }
            }

            function clickSubscriptionsButton() {
                const subscriptionsButton = document.querySelector(
                    'ytd-guide-collapsible-entry-renderer.style-scope:nth-child(8) > ytd-guide-entry-renderer:nth-child(1) > a:nth-child(1) > tp-yt-paper-item:nth-child(1)'
                );
                if (subscriptionsButton) {
                    subscriptionsButton.click();
                    setTimeout(getSubscriptions, 2000);
                } else {
                    setTimeout(clickSubscriptionsButton, 1000);
                }
            }

            function getSubscriptions() {
                const allSubscriptions = document.querySelectorAll(
                    'ytd-guide-section-renderer:nth-child(2) a#endpoint.yt-simple-endpoint[href^="/@"]'
                );
                if (allSubscriptions.length > 0) {
                    printAllSubscriptions(allSubscriptions);
                } else {
                    setTimeout(getSubscriptions, 1000);
                }
            }

            function closeGuide() {
                console.log('%cClosing guide...', 'color: red;');
                const guideButton = document.querySelector('#guide-button');
                const guideDrawer = document.querySelector('tp-yt-app-drawer#guide');

                if (guideButton) {
                    const isOpen = guideButton.getAttribute('aria-pressed') === 'true';
                    if (isOpen) {
                        guideButton.click();
                        setTimeout(() => {
                            if (guideButton.getAttribute('aria-pressed') === 'false') {
                                console.log('Guide successfully closed after gathering subscriptions');
                                if (guideDrawer) {
                                    guideDrawer.removeAttribute('opened');
                                    console.log('Removed "opened" attribute from guide drawer');
                                }
                                setGuideTransparency(false);
                            } else {
                                console.log('Failed to close guide. Retrying...');
                                closeGuide();
                            }
                        }, 500);
                    } else {
                        console.log('Guide was already closed');
                        if (guideDrawer) {
                            guideDrawer.removeAttribute('opened');
                            console.log('Removed "opened" attribute from guide drawer');
                        }
                        setGuideTransparency(false);
                    }
                }
            }

            openGuide();
        });
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

            if (subscribedChannels.has(normalizedChannelName)) {
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
                return;
            }

            if (isPlaylist(thumbnailElement) || isLive(thumbnailElement) || hasWatchProgress(thumbnailElement)) {
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
                return;
            }

            let viewCount = GM_getValue(videoId, 0);
            viewCount++;
            GM_setValue(videoId, viewCount);

            if (viewCount > Threshold) {
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
            } else {
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
        thumbnails.forEach(processThumbnail);
    }

    async function runEntireProcess() {
        if (!guideProcessing) {
            await loadSubscribedChannels();
            processExistingThumbnails();
            observeDOMChanges();
        }
    }

    function init() {
        if (document.readyState === 'complete') {
            runEntireProcess();
        } else {
            window.addEventListener('load', runEntireProcess);
        }

        document.addEventListener('yt-navigate-start', runEntireProcess);
        document.addEventListener('yt-navigate-finish', runEntireProcess);
    }

    init();
})();
