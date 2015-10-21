
var mqtt    = require('../')
  , max     = 1000000
  , i       = 0
  , start   = Date.now()
  , time
  , buf     = new Buffer(10)
  , net     = require('net')
  , server  = net.createServer(handle)
  , dest

function handle(sock) {
  sock.resume();
}

buf.fill('test')

server.listen(0, function() {
  dest = net.connect(server.address());

  dest.on('connect', tickWait);
  dest.on('drain', tickWait);

  dest.on('finish', function () {
    time = Date.now() - start;
    console.log('Total time', time);
    console.log('Total packets', max);
    console.log('Packet/s', max / time * 1000);
    server.close();
  });
});

function tickWait() {
  var res = true
  //var toSend = new Buffer(5)

  for (; i < max && res; i++) {
    res = mqtt.writeToStream({
        cmd: 'publish'
      , topic: 'test'
      , payload: buf
    }, dest)
    //dest.write(toSend, 'buffer')
    //res = dest.write(buf, 'buffer')
  }

  if (i >= max) {
    dest.end();
    return;
  }
}
