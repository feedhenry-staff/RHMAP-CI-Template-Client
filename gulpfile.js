
var gulp = require('gulp');
var Server = require('karma').Server;
var nightwatch = require('gulp-nightwatch');
var connect = require('gulp-connect');
var runSequence = require('run-sequence');
 
/**
 * Run unit test once and exit
 */
gulp.task('test:unit', function (done) {
  new Server({
    configFile: __dirname + '/karma.conf.js',
    singleRun: true
  }, done).start();
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
gulp.task('nightwatchPhantom', function(){
  return gulp.src('')
    .pipe(nightwatch({
      configFile: 'nightwatch.json'
    }));
});

// run tests with nightwatch and Chrome
gulp.task('nightwatchChrome', function(){
  return gulp.src('')
    .pipe(nightwatch({
      configFile: 'nightwatch.json',
      cliArgs: [ '--env chrome' ]
    }));
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