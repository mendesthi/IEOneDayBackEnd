module.exports = {
    extractVectors: function (file, callback) {
        return (extractVectors(file, callback))
    },

    SimilatiryScoring: function (vectors, numSimilars, callback) {
        return (SimilatiryScoring(vectors, numSimilars, callback))
    },

    Classify: function (text, callback) {
        return (Classify(text, callback));
    }
}

var request = require('request') // HTTP Client
var fs = require('fs')
var LeoServer = process.env.LEO_SERVER || "https://sandbox.api.sap.com/ml"

function extractVectors(file, callback) { 
    /** Official Documentation
     * https://help.sap.com/viewer/b04a8fe9c04745b98ad8652ccd5d636f/1.0/en-US/d6fee2fd184d48d5b221928a8db4c2fd.html
     *
     *  API Reference: https://api.sap.com/api/img_feature_extraction_api/overview
     * 
    **/

    console.log("LEO RECEIVED: "+file);

    var enpoint = process.env.LEO_FEATUREX_ENDPOINT || '/imagefeatureextraction/feature-extraction'
    var options = {
        url: LeoServer+enpoint,
        headers: {
            'APIKey': process.env.LEO_API_KEY,
            'Accept': 'application/json'
        },
        formData: {
            files: fs.createReadStream(file)
        }
    }

    request.post(options, function (err, res, body) {
        if (err || res.statusCode != 200) {
            console.error("LEO - Can't extract vector from " + file)
            if (err) {
                console.error(err)
            } else {
                err = "Status Code - " + res.statusCode + " - " + res.statusMessage
                logLeoError(enpoint, res, body)
            }
            callback(err, null)
        }
        else {
            body = JSON.parse(body)
            console.log("Vector(s) extracted for " + body.predictions.length + " image(s)")
            callback(null, body);

        }
    });
}


function SimilatiryScoring(vectorsZip, numSimilars, callback) {

    /** Official Documentation
     * https://help.sap.com/viewer/c6b1f1188a684b3b97f0a5e3c82f5f1e/1.0/en-US/0399fdf795a64c3b807258b4054bf279.html
     *
     *  API Reference: https://api.sap.com/api/similarity_scoring_api/overview
     * 
    **/

    numSimilars = numSimilars || 4
    var enpoint = process.env.LEO_SIMILARITY_ENDPOINT || '/similarityscoring/similarity-scoring'
    
    var options = {
        url: LeoServer+enpoint,
        headers: {
            'APIKey': process.env.LEO_API_KEY,
            'Accept': 'application/json',
        },
        formData: {
            files: fs.createReadStream(vectorsZip),
            options: '{"numSimilarVectors":' + numSimilars + '}'
        }
    }

    request.post(options, function (err, res, body) {
        if (err || res.statusCode != 200) {
            console.error("LEO - Can't run Similarity scoring at " + LeoServer + enpoint  + " for " + vectorsZip);
            if (!err) {
                err = "Status Code - " + res.statusCode + " - " + res.statusMessage
                logLeoError(enpoint, res, body)
            }
            console.error(err)
            callback(err, null)
        }
        else {
            body = JSON.parse(body)
            console.log("Vector(s) extracted for " + body.predictions.length + " image(s)")
            callback(null, body);

        }
    });
}



function Classify(text, callback) {
    var options = {
        "uri": LeoServer + "/sti/classification/text/classify",
        headers: {
            "APIKey": process.env.LEO_API_KEY,
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
    };

    options.body = JSON.stringify({
        "business_object": "ticket",
        "messages": [
            {
                "id": (Math.random() * 1000),
                "contents": [
                    {
                        "field": "text",
                        "value": text
                    }
                ]
            }
        ],
        "options": [
            {
                "classification_keyword": true
            }
        ]
    })

    //Make Request
    req.post(options, function (error, res, body) {
        body = JSON.parse(body);
        if (!error && res.statusCode == 200) {
            var classification = body.results[0].classification[0]
            console.log(
                "Text " + (classification.confidence * 100) + "% classified as a "
                + classification.value)
            return callback(null, res, classification);
        } else {
            console.error("Can't Analyse text due: " + body.status_message);
            console.error("Request Status Code: " + res.statusCode)
            return callback(body.status_message, res, null);
        }
    });
}

function logLeoError(endpoint, response, body){
    console.error("RESPONSE "+ endpoint+ " - " + response.statusCode + " - " + response.statusMessage)
    console.error("BODY"+ endpoint+ " - "+ body)

}