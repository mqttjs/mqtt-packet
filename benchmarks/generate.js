
var mqtt    = require('../')
  , max     = 1000000
  , i
  , start   = Date.now()
  , time

for (i = 0; i < max; i++) {
  mqtt.generate({
      cmd: 'publish'
    , topic: 'test'
    , payload: 'test'
  })
}

time = Date.now() - start
console.log('Total time', time)
console.log('Packet/s', max / time * 1000)
