
var mqtt    = require('../')
  , max     = 1000000
  , i       = 0
  , start   = Date.now()
  , time
  , buf     = new Buffer(10)
  , net     = require('net')
  , server  = net.createServer(handle)
  , dest

buf.fill('test')

function handle(sock) {
  sock.resume();
}

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

function tickWait () {
  //console.log('tickWait', i)
  var res = true
  //var toSend = new Buffer(5 + buf.length)

  for (; i < max && res; i++) {
    res = dest.write(mqtt.generate({
        cmd: 'publish'
      , topic: 'test'
      , payload: buf
    }))
    //buf.copy(toSend, 5)
    //res = dest.write(toSend, 'buffer')
    //console.log(res)
  }

  if (i >= max) {
    dest.end();
    return;
  }
}
