const {
    Worker, isMainThread, parentPort, workerData
} = require('node:worker_threads');

process.on('unhandledRejection', (e) => {
    console.error(e.transporterStackTrace);
    process.exit(1);
});

let limitedOrigin = null;

if (isMainThread) {
    const urls = require("./history.json");

    setInterval(() => {
        require('fs').writeFile("history.json", JSON.stringify(urls), {}, () => {});
    }, 30000);

    const algoliasearch = require('algoliasearch');
    let queue = Array(require('os').cpus().length).fill(Array).map(i => i());

    const client = algoliasearch(require('./credentials.json').id, require('./credentials.json').key);
    const searchIndex = client.initIndex('equestriadev');

    queue[0].push("https://unix.stackexchange.com");
    queue[1].push("https://askubuntu.com");
    queue[2].push("https://openai.com");
    queue[3].push("https://facebook.com");
    queue[4].push("https://en.wiktionary.org");
    queue[5].push("https://adobe.com");
    queue[6].push("https://discord.com");
    queue[7].push("https://mit.edu");

    let workers = [];

    async function crawl(id) {
        if (queue[id].length === 0) {
            setTimeout(() => {
                crawl(id);
            }, 1000);
            return;
        }

        let url = queue[id].shift();

        if (typeof limitedOrigin === "string" && new URL(url).origin !== limitedOrigin) {
            crawl(id);
            return;
        }

        if (Object.keys(urls).includes(url)) {
            const crypto = require('crypto');

            if (!urls[url]) {
                let urlInfo = new URL(url);
                urls[url] = crypto.createHash("sha256").update(urlInfo.hostname + "|" + urlInfo.port + "|" + urlInfo.pathname + "|" + urlInfo.search).digest("base64");
            }

            await searchIndex.partialUpdateObject({
                backlinks: {
                    _operation: 'Increment',
                    value: 1,
                },
                objectID: urls[url],
            });

            crawl(id);
        } else {
            urls[url] = null;
            workers[id].postMessage(url);
        }
    }

    for (let index in require('os').cpus()) {
        index = parseInt(index);
        workers[index] = new Worker(__filename, {
            workerData: index
        });

        workers[index].on('message', async (data) => {
            if (data.add) {
                if (typeof data.id === "string") {
                    urls[data.url] = data.id;

                    data.data.objectID = data.id;
                    data.data.url = data.url;
                    let record = data.data;

                    await searchIndex.saveObject(record);
                }

                for (let item of data.children) {
                    if (item.includes(".equestria.dev/") || item.includes("/equestria.dev/")
                        || item.includes(".equestria.horse/") || item.includes("/equestria.horse/")
                        || item.includes(".pone.eu.org/") || item.includes("/pone.eu.org/")
                        || item.includes(".ponycon.info/") || item.includes("/ponycon.info/")
                        || item.includes(".minteck.org/") || item.includes("/minteck.org/")
                        || item.includes(".conep.one/") || item.includes("/conep.one/")) {
                        queue[index].push(item);
                    } else {
                        let smallest = Math.min(...queue.filter((i, j) => j !== queue.length - 1).map(i => i.length));
                        let sel = queue.filter((i, j) => j !== queue.length - 1).filter(i => i.length === smallest)[0];
                        sel.push(item);
                    }
                }
            }

            crawl(index);
        });

        crawl(index);
    }
} else {
    let id = workerData;
    let userAgent = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; EquestriadevBot/1.0; +https://equestria.dev) Chrome/119.0.0 Safari/537.36";

    const ogs = require('open-graph-scraper');
    const cheerio = require("cheerio");
    const axios = require('axios');
    const robotsParser = require('robots-txt-parser');
    const robots = robotsParser({
        userAgent: 'EquestriadevBot',
        allowOnNeutral: true
    });
    const crypto = require('crypto');

    let urlId;

    console.log("[" + id + "] New thread is now waiting for crawl operations.");

    async function load(url) {
        try {
            console.log("[" + id + "] " + url);
            let urlInfo = new URL(url);

            let origin = urlInfo.origin;
            await robots.useRobotsFor(origin);

            urlId = crypto.createHash("sha256").update(urlInfo.hostname + "|" + urlInfo.port + "|" + urlInfo.pathname + "|" + urlInfo.search).digest("base64");

            if (!robots.canCrawlSync(url)) {
                parentPort.postMessage({
                    id: urlId,
                    add: false,
                    url,
                    children: [],
                    data: null
                });
                return;
            }

            const pageHTML = await axios.get(url, {
                headers: {
                    "User-Agent": userAgent
                }
            });

            url = pageHTML.request.res.responseUrl;

            if (!pageHTML.headers["content-type"].startsWith("text/html")) throw new Error("Invalid content type");

            const $ = cheerio.load(pageHTML.data);

            let next = [];

            $("a").each((index, element) => {
                next.push($(element).attr("href"));
            });

            next = [...new Set(next.filter(i => {
                try {
                    let url = new URL(i);
                    return !(url.protocol !== "http:" && url.protocol !== "https:");

                } catch (e) {
                    return false;
                }
            }))];

            let openGraph = (await ogs({ url: url, fetchOptions: {
                headers: {
                    'User-Agent': userAgent
                }
            } })).result;

            let data = {
                title: new URL(url).pathname,
                website: new URL(url).hostname,
                description: $('body *:not(script):not(style):not(meta):not(nav):not(aside):not(footer):not(header)').contents().map(function() {
                    return (this.type === 'text') ? $(this).text() : '';
                }).get().join(' ').trim().replaceAll("\t", " ").replaceAll("\n", " ").replaceAll(/ +/g, " ").substring(0, 512).trim(),
                favicon: null,
                language: null,
                backlinks: 1
            }

            data.title = openGraph.ogTitle;
            data.language = openGraph.ogLocale;
            data.description = openGraph.ogDescription.substring(0, 1000) ?? data.description;
            data.favicon = openGraph.favicon ?? data.favicon;

            parentPort.postMessage({
                id: urlId,
                add: true,
                url,
                children: next,
                data
            });
        } catch (e) {
            parentPort.postMessage({
                id: typeof urlId === "string" ? urlId : null,
                add: false,
                url,
                children: [],
                data: null
            });
        }
    }

    parentPort.on('message', (url) => {
        load(url);
    });

    setInterval(() => {}, 99999999);
}