const ytdl = require('@distube/ytdl-core');
const { logText } = require('./logger');
const globalUtils = require('./globalutils');

const embedder = {
    embed_cache: [],
    getEmbedInfo: async (url) => {
        return null; //to-do
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
                    proxy_url: thumbnailUrl,
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

            let type = "image";
            let embed = {};
            
            if (url.includes("youtube.com") || url.includes("youtu.be")) {
                embed = await embedder.embedYouTube(url);
            }
            
            if (!embed) {
                let result = await embedder.getEmbedInfo(url);

                if (result == null) {
                    continue;
                }

                embed = {
                    type: type,
                    inlineMedia: true,
                    url: url,
                    description: result.data.description,
                    title: result.data.title,
                    thumbnail: result.data.image != null ? {
                        proxy_url: result.data.image.url,
                        url: result.data.image.url,
                        width: (result.data.image.width > 800 ? 800 : result.data.image.width),
                        height: (result.data.image.height > 800 ? 800 : result.data.image.height)
                    } : null,
                    author: result.data.author != null ? {
                        url: url,
                        name: result.data.author
                    } : null,
                    provider: {
                        url: url,
                        name: result.data.publisher
                    }
                };
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