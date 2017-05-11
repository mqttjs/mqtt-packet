'use strict'

var Buffer = require('safe-buffer').Buffer
var max = 65536
var cache = {}
var buffer

function generateBuffer (i) {
  buffer = Buffer.allocUnsafe(2)
  buffer.writeUInt8(i >> 8, 0, true)
  buffer.writeUInt8(i & 0x00FF, 0 + 1, true)

  return buffer
}

function generateCache () {
  for (var i = 0; i < max; i++) {
    cache[i] = generateBuffer(i)
  }
}

function get (number, cacheNumbers) {
  if (cache[number]) return cache[number]

  if (cacheNumbers) {
    generateCache()
    return cache[number]
  }

  return generateBuffer(number)
}

module.exports = {
  get: get
}
