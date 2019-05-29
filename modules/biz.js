/**
 * Biz Logic functions 
 * this module is a "Middleware" to talk with multiple backend systems
 * it also normalizes and combine the different data structures from B1 and ByD
 * so the output data has a standard b1 format.
 */

const request = require("request");
const formidable = require('formidable');
const fs = require("fs");
const qs = require("qs")
const path = require("path")
const uuid = require('uuid');
const archiver = require("archiver")
const redis = require("redis")

const sql = require("./sql")
const leo = require("./leo")
const normalize = require("./normalize")
const odata = require("./odata")


const b1 = require("./erp/b1")
const byd = require("./erp/byd")

var client; // Redis Client

module.exports = {
    GetItems: function (query, callback) {
        return (GetItems(query, callback))
    },
    GetSalesOrders: function (options, callback) {
        return (GetSalesOrders(options, callback))
    },
    SimilarItems: function (body, callback) {
        return (SimilarItems(body, callback))
    },
    UpdateItemPrices() {
        return (UpdateItemPrices())
    },

    DownloadImage: function (uri, filename, callback) {
        return DownloadImage(uri, filename, callback)
    },

    RowToFile: function (row) {
        return (RowToFile(row))
    },
    FileToRow: function (file) {
        return (FileToRow(file))
    },

    CleanDirectory: function (directory) {
        return CleanDirectory(directory)
    },

    setClient: function (inClient) {
        client = inClient;
        b1.setClient(inClient)
        byd.setClient(inClient)
    }

}
function SimilarItems(req, callback) {

    if (req.body.url) {
        console.log("Dowloading image from: " + req.body.url)
        LoadImage(req.body, callback, AnalyzeImage)
    }
    else {
        console.log("Uploading image from file")
        UploadImage(req, callback, AnalyzeImage)
    }
}

let formatSimilarResponse = function (response) {
    return new Promise(function (resolve, reject) {
        var fResp = {}
        var filter = {};
        var SimilarHash = uuid.v1();

        console.log("Formatting Similarity Response")

        //Stores Item Similarity Score in Cache to be retrieved Later
        for (key in response) {
            if (fResp[response[key].origin] == null) {
                fResp[response[key].origin] = []
                filter[response[key].origin] = "productid" + odata.op("eq") + odata.qt(response[key].productid)
            }
            client.hset(SimilarHash, response[key].origin + response[key].productid, response[key].score) //Store scoring in Redis
            filter[response[key].origin] += odata.op("or") + "productid" + odata.op("eq") + odata.qt(response[key].productid)
        }

        var call = 0;

        //Get ERP data for the similar Items (Price, Qty, Name and etc..)
        for (key in filter) {
            console.log("Getting ERP Items Data")
            var re = GetErpItems(key, { $filter: filter[key] }).then(function (items) {
                fResp[Object.keys(items)] = items[Object.keys(items)].values;
                call++;

                if (call == Object.keys(filter).length) {
                    //Retrieve Score for each item
                    console.log("Getting Similarity Score from Cache")
                    mergeItemAndCache(fResp, SimilarHash).then(function (data) {
                        //Able to retrieve score from cache
                        console.log("Ranking Similar Items with ERP Data by Score")
                        for (erp in data) {
                            data[erp].sort(compareScore)
                        }
                        resolve(data)
                    }).catch(function () {
                        console.error("Can't retrieve Similarity Score from cache")
                        //Can't get score from cache, return Item without score
                        resolve(fResp)
                    })
                }
            })
        }
    })
}

function MostSimilarItems(base, similars, callback) {

    // SAP Leonardo Similarity Scoring provides a N x N comparision
    // This function retrieves only the relevant similarity result for
    // a base vector(the file provided as input)

    var resp = {};

    for (var i = 0; i < similars.predictions.length; i++) {
        var curr_id = similars.predictions[i].id
        curr_id = curr_id.substr(0, curr_id.indexOf(path.extname(curr_id)))

        if (base.indexOf(curr_id) > 0) {
            resp = similars.predictions[i].similarVectors
            for (var j = 0; j < resp.length; j++) {
                var fileName = resp[j].id
                var score = resp[j].score
                fileName = fileName.substr(0, fileName.indexOf(path.extname(fileName)))
                resp[j] = FileToRow(fileName)
                resp[j].score = score;
            }
            callback(resp);
            break;
        }
    }
}

function CreateSimilarityZip(library, similar, callback) {
    // Create e zip file of vectors to be used by the Similarity scoring service 
    var zipFile = path.join(process.env.VECTOR_DIR, uuid.v4() + '.zip');

    // create a file to stream archive data to the zip
    var output = fs.createWriteStream(zipFile);
    var archive = archiver('zip', { zlib: { level: 9 } }); // Sets the compression level. 

    // listen for all archive data to be written 
    output.on('close', function () {
        console.log("Zip Created - " + zipFile)
        console.log("Time to call Leonardo")
        callback(null, zipFile)
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            callback(err)
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function (err) {
        callback(err)
    });

    // pipe archive data to the file 
    archive.pipe(output);


    //Add vector to be compared (Similar) to the Zip
    var buff = Buffer.from(JSON.stringify(similar.predictions[0].featureVectors), "utf8");
    var fileName = similar.predictions[0].name
    fileName += '.txt'
    archive.append(buff, { name: fileName });


    //Add Vector library to the same zip
    for (key in library) {
        buff = Buffer.from(library[key].imgvector, "utf8");
        fileName = RowToFile(library[key])
        fileName += '.txt'
        archive.append(buff, { name: fileName });
    }
    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();
}

let GetErpItems = function (origin, query) {
    return new Promise(function (resolve, reject) {

        var erp = eval(origin);

        erp.GetItems(query, function (error, items) {
            if (error) {
                items = {};
                items.error = error;
            }
            var output = {};
            output[origin] = { values: items.error || items.value }

            if (items.hasOwnProperty("odata.nextLink")) {
                output[origin]["odata.nextLink"] = items["odata.nextLink"];
            }

            resolve(normalize.Items(output))
        })
    })
}

let mergeItemAndCache = function (itemList, hash) {
    return new Promise(function (resolve, reject) {

        client.hgetall(hash, function (err, replies) {

            if (!err) {
                console.log(replies + " scores in cache");

                for (erp in itemList) {
                    for (item in itemList[erp]) {
                        itemList[erp][item].score = replies[erp + itemList[erp][item].productid]
                    }
                }
                resolve(itemList);
            } else {
                reject(itemList)
            }
        });
    })
}


function GetItems(query, callback) {
    byd.GetItems({}, function (error, itemsByD) {
        if (error) {
            itemsByD = {};
            itemsByD.error = error;
        }
        b1.GetItems({}, function (error, itemsB1) {
            if (error) {
                itemsB1 = {};
                itemsB1.error = error;
            }

            var output = {
                b1: { values: itemsB1.error || itemsB1.value },
                byd: { values: itemsByD.error || itemsByD.value }
            }

            if (itemsB1.hasOwnProperty("odata.nextLink")) {
                output.b1["odata.nextLink"] = itemsB1["odata.nextLink"];
            }
            callback(null, normalize.Items(output))
        })
    })
}

function GetSalesOrders(query, callback) {
    byd.GetSalesOrders(query, function (errByd, soByD) {
        b1.GetOrders(query, function (errB1, soB1) {
            var output = {};
            output["b1"] = { values: errB1 || soB1.value }
            output["byd"] = { values: errByd || soByD.value }
            callback(null, normalize.SalesOrders(output))
        })
    })
}

function UpdateItemPrices() {
    sql.SelectErpItems("byd", function (error, result) {


        for (item in result) {
            if (item == 0) {
                var filter = filter = "productid" + odata.op("eq") + odata.qt(result[0].productid);
            } else {
                filter += odata.op("or") + "productid" + odata.op("eq") + odata.qt(result[item].productid);
            }
        }

        byd.GetItemPrice({ $filter: filter }, function (err, prices) {

            if (!err) {
                for (key in prices.value) {
                    var row = {
                        productid: prices.value[key].CIPR_PRODUCT,
                        origin: "byd",
                        price: prices.value[key].KCZF8AB2100987110A811399E,
                        currency: prices.value[key].RCITV_NET_AMT_RC
                    }
                    sql.InsertPrice(row)
                }
            } else {
                console.error(err)
            }
        })
    })
}

// Downloads an image from the body URL, called from SimilarItems
function LoadImage(body, maincallback, callback) {

    console.log("LoadImage " + body.url);
    //Handle images that requires parameters to be acessed
    var imgRequest = {
        method: "GET",
        url: body.url,
        qs: qs.parse(body.url)
    }
    
    var imgName = body.url;
    if (imgName.indexOf("?") > 0) {
        //There are parameters in the URL Request
        imgName = imgName.substr(0, body.url.indexOf("?"))
    }
    
    console.log("Downloading image from " + imgRequest)
    request.head(imgRequest, function (err, res, body) {
        var imgPath = path.join(process.env.TEMP_DIR, uuid.v4() + path.extname(imgName))
        request(imgRequest).pipe(fs.createWriteStream(imgPath)).on('close', function () {
            callback(imgPath, body, maincallback)
        });
    });
}

// Uploads an image from the request file content, called from SimilarItems
function UploadImage(req, maincallback, callback) {

    // create an incoming form object
    var form = new formidable.IncomingForm();
    // specify that we want to allow the user to upload multiple files in a single request
    form.multiples = false;
    // store all uploads in the /uploads directory
    form.uploadDir = process.env.TEMP_DIR;

    // File uploaded successfuly. 
    form.on('file', function (field, file) {
        //var filePath = uuid.v4() + file.path + '.jpg';
        fs.rename(file.path, file.path + '.jpg', function( error ) {});
        //Callback with the route to the file in the server
        callback(file.path + '.jpg', null, maincallback);
    });

    // log any errors that occur
    form.on('error', function (err) {
        console.log('An error has occured uploaiding the file: \n' + err);
        maincallback(null, err);
    });

    form.on('end', function (a,b,c) {
        console.dir(a)
        console.dir(b)
        console.dir(c)
    });

    // parse the incoming request containing the form data
    form.parse(req, function (err, fields, files) {
        console.log(files)
    });


}

// Analyzes an image in both cases: URL and File for SimilarItems
function AnalyzeImage(imgPath, body, callback) {

    var output = {}
    console.log("Extracting Vector for " + imgPath)
    leo.extractVectors(imgPath, function (error, vector) {  
        if (error) {
            console.error(error)
            output.message = "Can't Extract vector for " + imgPath + " - " + error;
            return callback(error, output)
        }

        console.log("Loading Vector Database")
        sql.SelectImages(function (error, result) {
            if (error) {
                console.error(error)
                output.message = "Can't retrieve vector database " + error;
                return callback(error, output)
            }

            console.log("Creating Zip with vector library")
            CreateSimilarityZip(result, vector, function (error, zipFile) {
                if (error) {
                    console.error(error)
                    output.message = "Cant Create library ZIP" + error;
                    return callback(error, output)
                }

                var numSimilar = null;
                if (body && body.hasOwnProperty("similarItems")) {
                    numSimilar = body.similarItems
                }

                console.log("Calling Leonardo Similarity Scoring")
                leo.SimilatiryScoring(zipFile, numSimilar, function (error, similars) {
                    if (error) {
                        console.error(error)
                        output.message = "Cant retrieve SimilatiryScoring - " + error;
                        return callback(error, output)
                    }

                    console.log("Ranking Similarity Response")
                    MostSimilarItems(imgPath, similars, function (SimilarResponse) {
                        console.log("Formating Similarity Response and retrieve ERP Data")
                        formatSimilarResponse(SimilarResponse).then(function (finalData) {

                            //Erase all files from temp directories
                            CleanDirectory(process.env.TEMP_DIR)
                            CleanDirectory(process.env.VECTOR_DIR)
                            callback(null, finalData)
                        })
                    })
                })
            })
        })
    })
}

// Called at Initialize to download one by one all the images
function DownloadImage(uri, filename, callback) {
    console.log("Downloading image from " + uri)
    request.head(uri, function (err, res, body) {
        var imgPath = path.join(process.env.TEMP_DIR, filename)
        request(uri).pipe(fs.createWriteStream(imgPath)).on('close', function () {
            callback(imgPath)
        });
    });
}

// Clean the temp directory after all files saved into the db
function CleanDirectory(directory) {

    console.log("Cleaning directory - " + directory)
    fs.readdir(directory, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            if (path.extname(file) != ".MD") {
                fs.unlink(path.join(directory, file), err => {
                    if (err) throw err;
                });
            }
        }
    });
}

function RowToFile(row) {
    return row.origin + process.env.FILE_SEP + row.productid + path.extname(row.image)
}

function FileToRow(file) {
    var row = {}
    var sep = process.env.FILE_SEP
    var ext = path.extname(file);

    row.origin = file.substr(0, file.indexOf(sep))
    file = file.substr(file.indexOf(sep) + sep.length, file.indexOf(ext))
    row.productid = file.substr(0, file.indexOf(ext))

    return row
}

function compareScore(a, b) {
    if (a.score < b.score)
        return 1;
    if (a.score > b.score)
        return -1;
    return 0;
}


