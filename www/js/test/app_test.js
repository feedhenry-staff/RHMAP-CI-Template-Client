describe("Demo app", function() {
  window.$fh = jasmine.createSpyObj("$fh", ["cloud"]);

  it("should run add correctly", function() {
    var result = app.add(3, 5);
    expect(result).toBe(8);
  });

  it("should run and yield incorrect answer", function() {
    var result = app.add(3, 11);
    expect(result).not.toBe(8);
  });

  it("should say hello", function() {
    app.hello("myName");
    expect($fh.cloud).toHaveBeenCalled();
    var args = $fh.cloud.calls.allArgs();
    expect(args[0][0].path).toBe("hello");
    expect(args[0][0].data.hello).toBe("myName");
  });

});