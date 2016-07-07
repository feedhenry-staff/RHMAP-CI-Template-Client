module.exports = {
 "call hello cloud with test name and verify response": function(browser) {
  browser.url("http://localhost:9001")
   .assert.title('Hello World')
   .waitForElementVisible("body", 2000)
   .verify.visible("#hello_to", 'Input is visible')
   .setValue('#hello_to', 'test user')
   .click('#say_hello')
   .waitForElementVisible('#cloudResponse', 3000)
   .assert.containsText('#cloudResponse', 'Calling Cloud.....')
   .pause(10000)
   .assert.containsText('#cloudResponse', 'Hello test user')
   .end();
 }
};