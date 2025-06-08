# Better-Youtube-Recomendation-Algorithm
Improves YouTube's recomendation algorithm.

It will work on both the [home page](https://www.youtube.com) and [where we usually watch videos](https://www.youtube.com/watch?v=vJCA7OVkUMk) 

# What does it do?
It will hide recommended videos:
- If their thumbnails have been seen more than 10 times [(this value can be changed here)](https://github.com/BadisG/Better-Youtube-Recomendation-Algorithm/blob/7171e025cc40f4f037e86ccd654e90edb07e63a0/main.user.js#L18)
- If they are from YouTube channels you are subscribed to
- If they are playlists
- If they are music mixes
- If they have a progress bar (indicating they have already been watched)
- If they are Upcoming

You can also set [specific terms](https://github.com/BadisG/Better-Youtube-Recomendation-Algorithm/blob/a2a3f98b5c9c23c4664b758c88ef13e782c8ebd7/main.user.js#L20) and [a minimum views threshold](https://github.com/BadisG/Better-Youtube-Recomendation-Algorithm/blob/7171e025cc40f4f037e86ccd654e90edb07e63a0/main.user.js#L19) for a more refined filtering.

# How to install
## 1) Install a user script manager:
   - For Firefox: [Greasemonkey](https://addons.mozilla.org/fr/firefox/addon/greasemonkey/)
   - For Chrome: [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=fr)


## 2) Install the script there
[Click on this link](https://github.com/BadisG/Better-Youtube-Recomendation-Algorithm/raw/refs/heads/main/main.user.js)

## 3) Load the youtube subscribers page
[Go there](https://www.youtube.com/feed/channels) and wait for the page to be fully loaded. This way you'll fetch the list of your subscribed channels, it'll be used to filter out videos that are from those channels. You only have to do it once (Even though it is suggested to do this from time to time to update that list).
