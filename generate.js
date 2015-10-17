'use strict';

var writeToStream = require('./writeToStream')
var bl = require('bl')

function generate(packet) {
  var stream = bl()
  writeToStream(packet, stream)
  return stream.slice()
}

module.exports = generate
