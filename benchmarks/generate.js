
var mqtt = require('../')
var max = 100000
var i
var start = Date.now()
var time
var buf = new Buffer('test')

for (i = 0; i < max; i++) {
  mqtt.generate({
    cmd: 'publish',
    topic: 'test',
    payload: buf
  })
}

time = Date.now() - start
console.log('Total time', time)
console.log('Total packets', max)
console.log('Packet/s', max / time * 1000)
