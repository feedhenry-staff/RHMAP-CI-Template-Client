var app = (function(exports) {
  exports.add = add;
  exports.hello = hello;

  function add(num1, num2) {
    return num1 + num2;
  }

  function hello(text, cb) {
    $fh.cloud({
        path: 'hello',
        data: {
          hello: text
        }
      },
      function(res) {
        cb(null, res);
      },
      function(code, errorprops, params) {
        cb({
          code: code,
          errorprops: errorprops,
          params: params
        });
      }
    );
  }
  return exports;
})(app || {});