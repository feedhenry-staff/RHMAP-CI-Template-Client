module.exports = function(config) {
  config.set({
    basePath: './',
    frameworks: ['jasmine'],
    files: [
      "./www/js/app.js",
      "./www/js/test/app_test.js"
    ],
    autoWatch: false,
    exclude: [
    ],
    plugins:[
      "karma-jasmine",
      "karma-phantomjs-launcher"
    ],
    preprocessors: {},
    reporters: ['dots'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['PhantomJS']
  });
};
