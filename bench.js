
var mqtt    = require('./')
  , parser  = mqtt.parser()
  , max     = 10000000
  , i
  , start   = Date.now()
  , time

for (i = 0; i < max; i++) {
  parser.parse(new Buffer([
    48, 10, // Header
    0, 4, // Topic length
    116, 101, 115, 116, // Topic (test)
    116, 101, 115, 116 // Payload (test)
  ]))
}

time = Date.now() - start
console.log('Total time', time)
