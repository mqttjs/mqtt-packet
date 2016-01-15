
var mqtt    = require('./')
, crypto  = require('crypto')
, max     = 100000
, i
, start   = Date.now() / 1000
, time
, errors  = 0
, randomPacket

function doParse () {
  var parser  = mqtt.parser()
  parser.on('error', onError)
  randomPacket = crypto.randomBytes(Math.floor(Math.random() * 10))
  parser.parse(randomPacket)
}

try {

  for (i = 0; i < max; i++) {
    doParse()
  }
}
catch(e) {

  console.log('Exception occured at packet ')
  console.log(new Buffer(randomPacket))
  console.log(e.message)
  console.log(e.stack)
}

function onError () {
  errors++
}

time = Date.now() / 1000 - start
console.log('Total time', Math.round(time * 100) / 100)
console.log('Errors/s', errors / time)
