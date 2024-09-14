const fetch = require('node-fetch');
const ytdl = require('@distube/ytdl-core');
const { logText } = require('./logger');
const globalUtils = require('./globalutils');
const cheerio = require('cheerio');

const hexToDecimal = (hex) => {
    if (hex.startsWith('#')) {
        hex = hex.slice(1);
    }

    return parseInt(hex, 16);
};

const embedder = {
    embed_cache: [],
    getEmbedInfo: async (url) => {
        try {
            let content = await fetch(url, {
                headers: {
                    'User-Agent' : 'Bot: Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
                }
            })
    
            if (!content.ok) {
                return null;
            }

            if (url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg")) {
                return null; //external image embeds do not work that well.
            }

            let should_embed = false;
            let text = await content.text();
            let $ = cheerio.load(text);
            let title = $('title').text();
            let description = $('meta[name="description"]').attr('content') ?? '';
            let color = $('meta[name="theme-color"]').attr('content') ? hexToDecimal($('meta[name="theme-color"]').attr('content')) : 7506394;
            let ogTitle = $('meta[property="og:title"]').attr('content');
            let twitterImage = $('meta[property="twitter:image"]').attr('content');

            let ogImage = $('meta[property="og:image"]').attr('content');
            
            if (!ogImage && twitterImage) {
                ogImage = twitterImage;
            }
            
            if (description || color || ogTitle || ogImage) {
                should_embed = true;
            }
            
            if (should_embed && ogTitle) {
                title = ogTitle;
            }

            let embedObj = {
                color: color,
                title: title,
                description: description
            }

            if (ogImage) {
                embedObj.image = {
                    url: ogImage,
                    width: 80,
                    height: 80
                }
            } //to-do: auto get image width & height

            return should_embed ? embedObj : null;
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    embedAttachedVideo: (url) => {
        return { 
            type: "video",
            inlineMedia: true,
            thumbnail: {
                proxy_url: url,
                url: url,
                width: 500,
                height: 500
            },
            video: {
                url: url,
                proxy_url: url,
                width: 500,
                height: 500
            },
        };
    },
    embedYouTube: async (url) => {
        try {
            const info = await ytdl.getInfo(url);
            const videoDetails = info.videoDetails;

            const thumbnails = videoDetails.thumbnails;

            const validThumbnails = thumbnails.filter(thumbnail =>
                thumbnail.width < 800 && thumbnail.height < 800
            );

            const largestThumbnail = validThumbnails.reduce((largest, current) => {
                const largestSize = largest.width * largest.height;
                const currentSize = current.width * current.height;
                return currentSize > largestSize ? current : largest;
            }, validThumbnails[0]);

            const thumbnailUrl = largestThumbnail.url;
            const thumbnailWidth = largestThumbnail.width;
            const thumbnailHeight = largestThumbnail.height;
            const uploader = videoDetails.author.name;
            const channelUrl = videoDetails.author.channel_url

            return {
                type: "video",
                inlineMedia: true,
                url: url,
                description: videoDetails.description,
                title: videoDetails.title,
                thumbnail: {
                    proxy_url: `/proxy?url=${thumbnailUrl}`,
                    url: thumbnailUrl,
                    width: thumbnailWidth,
                    height: thumbnailHeight
                },
                author: {
                    url: channelUrl,
                    name: uploader
                },
                provider: {
                    url: "https://youtube.com",
                    name: "YouTube"
                }
            };
        } catch (error) {
            logText(error, "error");

            return null;
        }
    },
    generateMsgEmbeds: async (content, attachment, force) => {
        let ret = [];
        
        if (attachment && (attachment.name.endsWith(".mp4") || attachment.name.endsWith(".webm"))) {
            ret.push(embedder.embedAttachedVideo(attachment.url));
        }

        let urls = content.match(/https?:\/\/[^\s]+/g);

        if (urls == null || urls.length > 5 || urls.length == 0) {
            return ret;
        }
        
        for(var url of urls) {
            let checkCache = embedder.embed_cache.find(x => x.url == url);

            if (checkCache && !force) {
                ret.push(checkCache.embed);

                continue;
            }

            let embed = {};
            
            if (url.includes("youtube.com/watch?v=") || url.includes("youtu.be/")) {
                embed = await embedder.embedYouTube(url);
            }

            if ((global.config.custom_invite_url != "" && url.includes(global.config.custom_invite_url)) || url.includes("oldcord.us") || url.includes("/invite/")) {
                continue;
            }
            
            if (!embed.title) {
                let result = await embedder.getEmbedInfo(url);

                if (result == null) {
                    continue;
                }

                embed = {
                    type: "rich",
                    url: url,
                    color: result.color,
                    description: result.description,
                    title: result.title,
                    thumbnail: result.image != null ? {
                        proxy_url: `/proxy?url=${result.image.url}`,
                        url: result.image.url,
                        width: (result.image.width > 800 ? 800 : result.image.width),
                        height: (result.image.height > 800 ? 800 : result.image.height)
                    } : null
                };

                if (!embed.thumbnail) delete embed.thumbnail;
            }

            ret.push(embed);

            embedder.embed_cache.push({
                url: url,
                embed: embed
            });
        }

        return ret;
    }
};

module.exports = embedder;