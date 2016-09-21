'use strict'

var max = 65536
var cache = {}
var buffer

for (var i = 0; i < max; i++) {
  buffer = new Buffer(2)
  buffer.writeUInt8(i >> 8, 0, true)
  buffer.writeUInt8(i & 0x00FF, 0 + 1, true)
  cache[i] = buffer
}

module.exports = cache
