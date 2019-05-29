/** App Initial Configuration **/

/* Load NodeJS Modules */
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const redis = require("redis")
const pg = require("pg")

/* Load Local Modules */
const biz = require('./modules/biz');
const sql = require('./modules/sql');
const start = require('./modules/start')

/* Configure Redis */
console.log("Configuring redis")
var credentials = null;
var vcap = null;
if (process.env.VCAP_SERVICES) {
    credentials = {}
    vcap = JSON.parse(process.env.VCAP_SERVICES);
    credentials = vcap['redis'][0].credentials;
    credentials.host = credentials.hostname
    console.log("Redis credentials found in VCAP")
};
var redisClient = redis.createClient(credentials);
redisClient.on('connect', function () {
    console.log("Connected to Redis")
    biz.setClient(redisClient)
});

/* Configure PostgreSQL */
credentials = null;
if (vcap) {
    credentials = { connectionString: vcap.postgresql[0].credentials.uri }
    console.log("Postgree credentials found in VCAP")
};
var pgClient = new pg.Client(credentials)
pgClient.connect(function (err) {
    if (err) {
        console.error("Error Connecting to PostgreSQL - \n" + err)
    } else {
        console.log('PostegreSQL connected')
        sql.setClient(pgClient);
    }
})

/* Configure Express App */
console.log("Configuring Express App")
const app = express();
app.use(express.static('public'));
console.log("Allowing CORS...")
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

//To Support body on post requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//Static folder (to css and js front end files)
app.use(express.static('public'));


setInterval(biz.UpdateItemPrices,1.8e+6)

/* Express API */
// Root path to retrieve Index.html
app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/Items', function (req, res) {
    console.log("REQUEST: List Items")
    biz.GetItems(req.query, function (error, response) {
        res.setHeader('Content-Type', 'application/json')
        res.status(200)
        res.send(response)
    })
});

app.get('/SalesOrders', function (req, res) {
    console.log("REQUEST: List Sales Orders")
    biz.GetSalesOrders(req.query, function (error, response) {
        res.setHeader('Content-Type', 'application/json')
        res.status(200)
        res.send(response)
    })
});

app.get('/SelectDB', function (req, res) {
    sql.Select(function (error, response) {
        res.setHeader('Content-Type', 'application/json')
        res.status(200)
        res.send(response)
    })
});
app.post('/Initialize', function (req, res) {
    console.log("POST REQUEST: Initialize System")
    start.Initialize();
    var output = {
        message: "executing"
    };
    res.setHeader('Content-Type', 'application/json')
    res.send(output)

});

app.post('/SimilarItems', function (req, res) {

    console.log("Finding similiar Items for: ")
    console.log(req.body)
    biz.SimilarItems(req, function (err, resp) {
        res.setHeader('Content-Type', 'application/json')
        if (err) {
            res.status(500).send(resp)
        } else {
            console.dir(resp);
            res.status(200).send(resp)
        }
    });
    console.log('GetSimilarItems')
});

app.delete('/CleanDB', function (req, res) {

    console.log("Clean ALL Items")
    sql.Clean(function (err, resp) {
        res.setHeader('Content-Type', 'application/json')
        if (err) {
            res.status(500).send(resp)
        } else {
            console.dir(resp);
            res.status(200).send(resp)
        }
    });
    console.log('Clean ')
});

var port = process.env.PORT || 30000
app.listen(port, function () {
    console.log('Example app listening on port ' + port);
});

