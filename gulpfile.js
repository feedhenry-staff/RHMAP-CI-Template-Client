var gulp = require('gulp');
var Server = require('karma').Server;
var nightwatch = require('gulp-nightwatch');
var connect = require('gulp-connect');
var runSequence = require('run-sequence');
var fs = require('fs');
var request = require('request');
var async = require('async');
var fhc = require('fh-fhc');
var sendGrid = require('sendgrid').mail;

process.env.rhmapClientConfig = './rhmap.conf-client.json';
process.env.fhConfig = './www/fhconfig.json';

var latestArtifact = {};

/**
 * Run unit test once and exit
 */
gulp.task('test:unit', function (done) {
    var spawn=require("child_process").spawn;
    var cp=spawn(__dirname+"/node_modules/.bin/karma",["start","--single-run"],{
      stdio:"inherit"
    });
    cp.on("close",done);
    // new Server({
    //     configFile: __dirname + '/karma.conf.js',
    //     singleRun: true
    // }, done);
});


// fire up server for www folder
gulp.task('connect', function() {
    return connect.server({
        port: 9001,
        root: 'www'
    });
});

// task to close server when tests complete
gulp.task("kill-server", function () {
    return connect.serverClose();
});

// run tests with nightwatch and phantomJS browser
gulp.task('nightwatchPhantom', function(cb){
    gulp.src('')
        .pipe(nightwatch({
            configFile: 'nightwatch.json'
        })
    )
    .on('error',function(){cb();})
    .on('end',cb);
});

// run tests with nightwatch and Chrome
gulp.task('nightwatchChrome', function(cb){
    gulp.src('')
        .pipe(nightwatch({
            configFile: 'nightwatch.json',
            cliArgs: [ '--env chrome' ]
        })
    )
    .on('error',function(){cb();})
    .on('end',cb);
});

// start server
// run all e2e tests
// close server
gulp.task("test:e2e", function (cb) {
    runSequence(
    "connect",
    "nightwatchPhantom",
    "nightwatchChrome",
    "kill-server",
    cb);
});


gulp.task('default', ['unit-test']);
gulp.task('e2ePhantom', ['connect', 'nightwatchPhantom']);
gulp.task('e2eChrome', ['connect', 'nightwatchChrome']);

//Initalise properties in the rhmap.conf-client.json file if they do not exist
gulp.task('fhc-client-setup', ['fhc-login-basic'], function(done){
    var fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig)),
        rhmapConfFileContent = {},
        requestsArr = [];

    //Check if the config file exists
    var configExists = fs.existsSync(process.env.rhmapClientConfig);

    //If it doesn't, create a new blank file
    // If it does, read it so we can check if properties already exist within it
    if(!configExists){
        fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify({}));
    } else {
        rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));
    }

    if(!rhmapConfFileContent.build){
        rhmapConfFileContent.build = {};
    }

    //default to one PATCH version above what is currently in fhconfig
    if(!rhmapConfFileContent.build.newconnectiontag){
        rhmapConfFileContent.build.newconnectiontag = incrementSemVerNum(fhConfFileContent.connectiontag);
    }

    //destination is used for the build destination type e.g. android, ios, windows etc
    if(!rhmapConfFileContent.build.destination){
        rhmapConfFileContent.build.destination = "android";
    }

    //branch to use for the build
    if(!rhmapConfFileContent.build.branch){
        rhmapConfFileContent.build.branch = "master";
    }

    //If set to true, it will download the build binary to the ./binaries folder
    if(!rhmapConfFileContent.build.download){
        rhmapConfFileContent.build.download = true;
    }

    //Array of strings. User input RHMAP team names that are emailed after a succesful build
    if(!rhmapConfFileContent.build.teamsToEmailOnBuild){
        rhmapConfFileContent.build.teamsToEmailOnBuild = [];
    }

    //Login details for RHMAP domain
    if(!rhmapConfFileContent.login){
        rhmapConfFileContent.login = {};
    }

    if(!rhmapConfFileContent.login.username){
        rhmapConfFileContent.login.username = "";
    }

    if(!rhmapConfFileContent.login.password){
        rhmapConfFileContent.login.password = "";
    }

    if(!rhmapConfFileContent.login.apikey){
        rhmapConfFileContent.login.apikey = "";
    }

    if(!rhmapConfFileContent.appstore){
        rhmapConfFileContent.appstore = {};
    }

    //Name of the private app store item which all binaries will be uploaded to
    if(!rhmapConfFileContent.appstore.storeitemname){
        requestsArr.push(function(callback){fhcLoad(function(){
            fhc.projects({_: ["read", fhConfFileContent.projectid]}, function(err, project){
                if (err) return done(err);

                rhmapConfFileContent.appstore.storeitemname = project.title + " - " + fhConfFileContent.apptitle;

                callback();
            });
        })});
    }

    //Title of the project the app lives in
    if(!rhmapConfFileContent.projecttitle){
        requestsArr.push(function(callback){fhcLoad(function(){
            fhc.projects({_: ["read", fhConfFileContent.projectid]}, function(err, project){
                if (err) return done(err);

                rhmapConfFileContent.projecttitle = project.title;

                callback();
            });
        })});
    }

    if(!rhmapConfFileContent.build.cloudappid){
        requestsArr.push(function(callback){fhcLoad(function(){
            fhc.connections({_: [fhConfFileContent.projectid]}, function(err, connections){
                if (err) return done(err);

                //2 ways to get cloud app id
                //(1) Get tag from fhconfig.json and use the cloud appid associated with it - only issue is fhc build doesn't update with new tags in the studio.
                //(2) Fallback - Get highest tag number from response and use the cloud appid associated with it.

                //(1)
                for(var i=0; i < connections.length; i++){
                    var connection = connections[i];

                    if(connection.tag === fhConfFileContent.connectiontag){
                        rhmapConfFileContent.build.cloudappid = connection.cloudApp;
                        break;
                    }
                }

                //(2)
                if(!rhmapConfFileContent.build.cloudappid){
                    //sorts connections by tag in asscending order
                    connections.sort(compareVersionNumbers);

                    //set cloudappid to one associated with highest tag version number(last in array after sort)
                    rhmapConfFileContent.build.cloudappid = connections[connections.length - 1].cloudApp;
                }

                callback();
            });
        })});
    }

    //Only reason to use async.parallel is to have a single function once all async requests are finished to call done() which lets gulp know the task is finished and do other common tasks like write to config file
    async.parallel(requestsArr, function(err, results){
        //write back to config file
        fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify(rhmapConfFileContent, null, '\t'));

        done();
    })
})

gulp.task('fhc-client-build', ['fhc-client-setup'], function(done) {
    var fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig)),
        rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig)),
        args = structureArgs(process.argv);

    //TODO - check fileContent.build for other build info and add it to build parameters if they exist
    //TODO - QUESTION - Is there a way to specify environment?

    //var destination = args.destination || "android";

    fhcLoad(function(){
      var args={_: ["project="+fhConfFileContent.projectid, "app="+fhConfFileContent.appid, "destination="+rhmapConfFileContent.build.destination, "cloud_app="+rhmapConfFileContent.build.cloudappid, "tag="+rhmapConfFileContent.build.newconnectiontag, "branch="+rhmapConfFileContent.build.branch]};
        fhc.build(args, function(err, res){
            if (err) return done(err);

            //TODO - QUESTION - Do i need to check for if res.status = complete? (IMO, probably should be. Need to check in what scenarios status returns other than complete )
            //TODO - QUESTION - Why is the studio not getting updated with new build/binary info? Is it an environment issue?

            //Set old connectiontag to new conn tag from build
            fhConfFileContent.connectiontag = rhmapConfFileContent.build.newconnectiontag;
            //Increment build connection tag, ready for next build
            rhmapConfFileContent.build.newconnectiontag = incrementSemVerNum(rhmapConfFileContent.build.newconnectiontag);

            //If download is set to tue, download the build binary locally
            if(rhmapConfFileContent.build.download){
                //get just the filename from the url to use once we save the binary
                var url = res[0][0].action.url,
                    fileName = url.split('/').pop().split('?').shift();

                //If the binaries dir doesn't exist, create it
                if(!fs.existsSync('./binaries')){
                    fs.mkdirSync('./binaries');
                }

                //Useing the request module to retrieve the binary and the fs module to write it into the binaries folder
                request
                  .get(url)
                  .on('error', function(err) {
                    console.log(err)
                  })
                  .pipe(fs.createWriteStream('./binaries/' + fileName));

                //Update the config with binaryPath (only keeps latest). Used when uploading binary to private appstore
                rhmapConfFileContent.appstore.localbinarypath = './binaries/' + fileName;
            }

            //write back to config files
            fs.writeFileSync(process.env.fhConfig, JSON.stringify(fhConfFileContent, null, '\t'));
            fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify(rhmapConfFileContent, null, '\t'));

            done();
        });
    });
})

//Create a private app store item associated to the client app
gulp.task('fhc-store-create-item', ['fhc-client-setup'] ,function(done){
    var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

    //first check if an item for this client app already exists in the store
    fhcLoad(function(){
        fhc["admin-storeitems"]({_: []}, function(err, res){
            if (err) return done(err);

            var storeItemAlreadyExists = false,
                storeItemId;

            //Looping over the store items and checking it exists based on the name
            for(var i = 0; i < res.list.length; i++){
                var storeItem = res.list[i];

                if(rhmapConfFileContent.appstore.storeitemname === storeItem.name){
                    storeItemAlreadyExists = true;
                    storeItemId = storeItem.guid;
                    break;
                }
            }

            //Create a store item if it doesn't exists. If it does exist, update the storeItemId in the config file
            if(!storeItemAlreadyExists){
                //First step is creating the store item (admin-storeitems create), second is adding it to the store (admin-appstore additem). This connection is not done automatically
                fhcLoad(function(){
                    fhc["admin-storeitems"]({_: ["create", rhmapConfFileContent.appstore.storeitemname]}, function(err, res){
                        if (err) return done(err);

                        storeItemId = res.guid;

                        fhcLoad(function(){
                            fhc["admin-appstore"]({_: ["additem", storeItemId]}, function(err, res){
                                if (err) return done(err);

                                rhmapConfFileContent.appstore.storeitemid = storeItemId;
                                fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify(rhmapConfFileContent, null, '\t'));

                                done();
                            });
                        });
                    });
                });
            } else {
                rhmapConfFileContent.appstore.storeitemid = storeItemId;
                fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify(rhmapConfFileContent, null, '\t'));

                done();
            }
        });
    });
})

//Upload the app binary to private app store
gulp.task('fhc-store-upload-binary', ['fhc-store-create-item'],function(done){
    var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

    //Checks that there is a localbinarypath set in the config file from the build
    if(!rhmapConfFileContent.appstore.localbinarypath){
        return done("Please run fhc-client-build first with download=true set in the config file");
    }
    //upload the binary
    fhcLoad(function(){
        fhc["admin-storeitems"]({_: ['uploadbinary', rhmapConfFileContent.appstore.storeitemid, rhmapConfFileContent.build.destination, rhmapConfFileContent.appstore.localbinarypath]}, function(err, res){
            if (err) return done(err);

            console.log(res);
            done();
        });
    });
})

gulp.task('fhc-build-and-upload-binary', function(done){
    runSequence('fhc-client-build', 'fhc-store-upload-binary', done);
})


gulp.task('fhc-email-users-for-build', ['fhc-last-build-info', 'fhc-client-setup'], function(done){
    var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

    //Get all teams from RHMAP
    fhcLoad(function(){
        fhc.admin.teams.list({_: []}, function(err, teams){
            if (err) return done(err);

            //need to have run fhc-last-build-info gulp task before this to populate latestArtifact which is used to dynamically generate email content and subject
            var emailSubject = generateBuildEmailSubject(),
                emailContent = generateBuildEmailContent();

            var teamIds = [],
                requestsArr = [];

            //Loop over the returned RHMAP teams
            teams.forEach(function(team){
                var teamsToEmail = rhmapConfFileContent.build.teamsToEmailOnBuild;

                //Loop over the config teamsToEmail to check which teams to email
                for(var j=0; j < teamsToEmail.length; j++){
                    if(teamsToEmail[j] === team.name){

                        //Don't actually have team users emails, need to send another request to read the single team to get actual email addresses
                        requestsArr.push(function(callback){fhcLoad(function(){
                            fhc.admin.teams.read({id: team._id}, function(err, team){
                                if (err) return done(err);
                                var users = team.users;
                                //Loop over the returned RHMAP users in team and send email to each one
                                users.forEach(function(user){
                                    sendMailWithSendGrid(user.email, emailSubject, emailContent);
                                })

                                callback();
                            });
                        })});

                        continue;
                    }
                } //end Config team loop
            }) //end RHMAP team loop

            //Only reason to use async.parallel is to have a single function once all async requests are finished to call done() which lets gulp know the task is finished and do other common tasks like write to config file
            async.parallel(requestsArr, function(err, results){
                //all emails done
                done();
            })
        });
    })
})

gulp.task('fhc-last-build-info', function(done){
    var fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig));

    fhcLoad(function(){
        fhc.artifacts({_: [fhConfFileContent.projectid, fhConfFileContent.appid]}, function(err, artifacts){
            if (err) return done(err);

            //Variable set at top of gulp file outside of tasks
            latestArtifact = artifacts.shift();
            console.log(latestArtifact);

            done();
        });
    })
})

gulp.task('fhc-build-and-email', function(done){
    runSequence('fhc-client-build', 'fhc-email-users-for-build', done);
})


/*
 *
 * COMMON FHC CLIENT/CLOUD GULP TASKS
 *
 */

//Sets the target host for fhc to talk too
gulp.task('fhc-target', function(done){
    var fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig));

    fhcLoad(function(){
        fhc.fhcfg({_ : ["get", "feedhenry"]}, function(err, host){
            if (err) return done(err);
            //Checking if the currently connected to host is the same as what is in the config file
            //if it's not, then target the host in the config file
            if(!host || host.slice(0, -1) !== fhConfFileContent.host){
                fhcLoad(function(){
                    fhc.target({_ : [fhConfFileContent.host]}, function(err, res){
                        if (err) return done(err);

                        console.log("Successfully targeted " + fhConfFileContent.host);

                        done();
                    });
                }, done);
            } else {
                done();
            }
        });
    }, done);
})

//fhc also needs an authenticated user
gulp.task('fhc-login-basic', ['fhc-target'], function(done){

    var configExists = fs.existsSync(process.env.rhmapClientConfig);

    //If it doesn't, create a new blank file
    // If it does, read it
    if(!configExists){
        fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify({}));
        console.log('Please specify the username and password in the ' + process.env.rhmapClientConfig + ' file')
        done();
    } else {
        var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

        fhcLoad(function(){
            fhc.fhcfg({_ : ["get", "username"]}, function(err, username){
                if (err) return done(err);
                //Checking if the currently logged in user is the same as what is in the config file
                //if it's not, then login the user that's in the config file
                if(username !== rhmapConfFileContent.login.username){
                    fhcLoad(function(){
                        fhc.login({_ : [rhmapConfFileContent.login.username, rhmapConfFileContent.login.password]}, function(err, res){
                            if (err) return done(err);

                            console.log("Finished login with status of '" + res.result + "' by user " + rhmapConfFileContent.login.username + " to the domain " + res.domain);

                            done();
                        });
                    }, done);
                } else {
                    done();
                }
            });
        }, done);
    }
})

//fhc also needs an authenticated user
gulp.task('fhc-login-apikey', ['fhc-target'], function(done){

    var configExists = fs.existsSync(process.env.rhmapClientConfig);

    //If it doesn't, create a new blank file
    // If it does, read it
    if(!configExists){
        fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify({}));
        console.log('Please specify the api key in the ' + process.env.rhmapClientConfig + ' file');
        done();
    } else{
        var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig)),
            apiKey = rhmapConfFileContent.login.apikey;

        if(!apiKey){
            console.log('Please specify the api key in the ' + process.env.rhmapClientConfig + ' file');
            return done();
        }

        fhcLoad(function(){
            fhc.fhcfg({_ : ["get", "user_api_key"]}, function(err, cfgApiKey){
                if (err) return done(err);
                //Checking if the currently stored api key is the same as what is in the config file
                //if it's not, then set the api key in teh cfg file
                if(cfgApiKey !== apiKey){
                    fhcLoad(function(){
                        fhc.fhcfg({_ : ["set", "user_api_key", apiKey]}, function(err, res){
                            if (err) return done(err);

                            console.log("Finished setting API key");

                            done();
                        });
                    }, done);
                } else {
                    done();
                }
            });
        }, done);
    }
})

//set properties in config file. Use format --property=value
gulp.task('fhc-set-config', function(done){

    var configExists = fs.existsSync(process.env.rhmapClientConfig),
        args = structureArgs(process.argv);

    if(!configExists){
        console.log('Config file does not exist, please run fhc-client-setup')
    } else if (isEmpty(args)){
        console.log('No arguments specified. should be structured as --argument=value')
    } else {
        var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

        for (var key in args) {
            if (args.hasOwnProperty(key)) {
                var exists = rhmapConfFileContent[key],
                    text = exists ? "Changed " : "Added ";

                console.log(text + "property: " + key + ". old value: " + rhmapConfFileContent[key] + ", new value: " + args[key])
                rhmapConfFileContent[key] = args[key];
            }
        }

        fs.writeFileSync(process.env.rhmapClientConfig, JSON.stringify(rhmapConfFileContent, null, '\t'));
    }

    done();
})

//Read from config. PRints entire config to console if no parameter set. Otherwise use format --property
gulp.task('fhc-get-config', function(done){

    var configExists = fs.existsSync(process.env.rhmapClientConfig),
        args = process.argv;

    if(!configExists){
        console.log('Config file does not exist, please run fhc-client-setup')
    } else {
        var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig));

        if (args.length <= 3){
            console.log(rhmapConfFileContent);
            return done();
        }

        var key = process.argv[3].substring(2);

        if(rhmapConfFileContent[key]){
            console.log(key + " = " + rhmapConfFileContent[key]);
        } else {
            console.log('Property ' + key + ' does not exist');
        }
    }

    done();
})

//all command through the fhc module need to be wrapped inside an fhcLoad
function fhcLoad(func, done){
    var conf = {
      _exit: false
    };

    fhc.load(conf, function(err){
        if (err) return done(err);

        func();
    });
}


/*
 *
 * Util functions
 *
 */
function sendMailWithSendGrid(toEmail, subject, content){
    console.log('sending email: '+ toEmail);

    var from_email = new sendGrid.Email("jenkinsuser@example.com"),
        to_email = new sendGrid.Email(toEmail),
        subject = subject,
        content = new sendGrid.Content("text/html", content),
        mail = new sendGrid.Mail(from_email, subject, to_email, content);

    var sg = require('sendgrid').SendGrid(process.env.SENDGRID_API_KEY);
    var requestBody = mail.toJSON();
    var request = sg.emptyRequest();

    request.method = 'POST';
    request.path = '/v3/mail/send';
    request.body = requestBody;

    sg.API(request, function (response) {
        //console.log(response.statusCode);
        //console.log(response.body);
        //console.log(response.headers);
    })
}

function generateBuildEmailContent(){
    var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig)),
        fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig));

    //Example - Build - Project Name, App Name - Android [v39]
    return "<strong>Project Title:</strong> " + rhmapConfFileContent.projecttitle + "<br>" +
    "<strong>App Title:</strong> " + fhConfFileContent.apptitle + "<br>" +
    "<strong>Platform:</strong> " + latestArtifact.destination + "<br>" +
    "<strong>App Version:</strong> " + latestArtifact.appVersion + "<br>" +
    "<strong>Date:</strong> " + latestArtifact.sysCreated + "<br>" +
    "<strong>Type:</strong> " + latestArtifact.type + "<br><br>" +
    "<strong>Download URL:</strong> <a href='" + latestArtifact.downloadurl + "'>" + latestArtifact.downloadurl + "</a>"
}

function generateBuildEmailSubject(){
    var rhmapConfFileContent = JSON.parse(fs.readFileSync(process.env.rhmapClientConfig)),
        fhConfFileContent = JSON.parse(fs.readFileSync(process.env.fhConfig));

    //Example - Build - Project Name, App Name - Android [v39]
    return "Build - " + rhmapConfFileContent.projecttitle + ", " + fhConfFileContent.apptitle + " - " + latestArtifact.destination + "[v" + latestArtifact.appVersion +"]"
}

function structureArgs(args){
    var structuredArgs = {},
        key;

    //first 3 arguments are always gulp related. Can be ignored by the loop
    for (var i = 3; i < args.length; i++) {
        var arg = args[i];
        //remove initial 2 dashes (--) if they exist
        if(arg.substring(0, 2) === "--"){
            arg = arg.substring(2);
        }

        //can accept arguments in 2 ways. First is --argument=value. Second is --argument value
        if(arg.indexOf("=") > -1){
            var vals = arg.split('=');
            //Key is everything before = . Value everything afterwards =
            structuredArgs[vals[0]] = vals[1];
        } else {
            //Arguments passed in as --argument value. Persisting the initial argument as the key and next iteration of the loop is the value.
            if(!key){
                key = arg;
            } else {
                structuredArgs[key] = arg;
                key = null;
            }

        }
    }

    return structuredArgs;
}

function incrementSemVerNum(semVerNum){
    //split the string into array of strings
    var semVerArr = semVerNum.split(".");
    //increment the patch number
    semVerArr[2] = parseInt(semVerArr[2]) + 1;
    //return joined semVer string
    return semVerArr.join(".");
}

/**
 * Compare two software version numbers (e.g. 1.7.1)
 * Returns:
 *
 *  0 if they're identical
 *  negative if v1 < v2
 *  positive if v1 > v2
 *  Nan if they in the wrong format
 *
 *  Taken from http://stackoverflow.com/a/6832721/11236
 */
function compareVersionNumbers(v1, v2){
    var v1parts = v1.tag.split('.');
    var v2parts = v2.tag.split('.');

    // First, validate both numbers are true version numbers
    function validateParts(parts) {
        for (var i = 0; i < parts.length; ++i) {
            if (!isPositiveInteger(parts[i])) {
                return false;
            }
        }
        return true;
    }
    if (!validateParts(v1parts) || !validateParts(v2parts)) {
        return NaN;
    }

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length === i) {
            return 1;
        }

        if (v1parts[i] === v2parts[i]) {
            continue;
        }
        if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        return -1;
    }

    if (v1parts.length != v2parts.length) {
        return -1;
    }

    return 0;
}

function isPositiveInteger(x) {
    // http://stackoverflow.com/a/1019526/11236
    return /^\d+$/.test(x);
}

function isEmpty(obj) {
  return !Object.keys(obj).length > 0;
}