var app = {};

document.getElementById('say_hello').onclick = function() {
  document.getElementById('cloudResponse').innerHTML = "<p>Calling Cloud.....</p>";
  app.hello(document.getElementById('hello_to').value, function(err, res) {
    if (err) {
      alert('An error occured: ' + err.code + ' : ' + err.errorprops);
    } else {
      document.getElementById('cloudResponse').innerHTML = "<p>" + res.msg + "</p>";
    }
  });
};


