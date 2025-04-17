const express = require('express');
const cookieParser = require('cookie-parser');
const algoliasearch = require('algoliasearch');
const fs = require('fs');
const axios = require('axios');

const redirect = "http://localhost:3000/callback";

if (!fs.existsSync("./tokens")) fs.mkdirSync("./tokens");

const client = algoliasearch(require('./credentials.json').id, require('./credentials.json').key);
const searchIndex = client.initIndex('equestriadev');

const app = express();
app.set('view engine', 'ejs');
app.use(cookieParser());

app.use('/assets', express.static('assets'));

app.get('/', async (req, res) => {
    if (!req.cookies['SEARCH_AUTH'] || req.cookies['SEARCH_AUTH'].includes("/") || req.cookies['SEARCH_AUTH'].includes(".") || !fs.existsSync("./tokens/" + req.cookies['SEARCH_AUTH'].trim())) {
        res.redirect(302, "https://account.equestria.dev/hub/api/rest/oauth2/auth?client_id=" + require('./credentials.json').client + "&response_type=code&redirect_uri=" + redirect + "&scope=Hub&request_credentials=default&access_type=offline");
        return;
    }

    if (typeof req.query['q'] === "string") {
        if (req.query['q'].trim() === "") {
            res.redirect(301, "/");
            return;
        }

        res.render(__dirname + '/pages/search', {req, res, data: await searchIndex.search(req.query['q'])});
    } else {
        res.render(__dirname + '/pages/index', {req, res, data: null});
    }
});

app.get('/callback', async (req, res) => {
    if (req.query['code']) {
        let token = (await axios.post("https://account.equestria.dev/hub/api/rest/oauth2/token",
            "grant_type=authorization_code&redirect_uri=" + encodeURIComponent(redirect) + "&code=" + encodeURIComponent(req.query['code']),
            {
                headers: {
                    Authorization: "Basic " + Buffer.from(require('./credentials.json').client + ":" + require('./credentials.json').secret).toString("base64"),
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json"
                }
            }
        )).data;

        if (token['access_token']) {
            let data = (await axios.get("https://account.equestria.dev/hub/api/rest/users/me", {
                headers: {
                    Authorization: "Bearer " + token['access_token'],
                    Accept: "application/json"
                }
            })).data;

            if (require('./credentials.json').allowed.includes(data.id)) {
                let token = require('crypto').randomBytes(128).toString("base64url");
                await fs.promises.writeFile("./tokens/" + token, JSON.stringify(data));
                res.cookie("SEARCH_AUTH", token, {
                    expires: new Date(Date.now() + 86400*365),
                    httpOnly: true
                });
                res.redirect(302, "/");
            } else {
                res.status(403);
                res.send("Not allowed to access this application.");
            }
        } else {
            res.redirect(302, "/");
        }
    } else {
        res.redirect(302, "/");
    }
});

app.listen(3000, () => console.log('App is listening on port 3000.'));