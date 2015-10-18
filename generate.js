'use strict';

var writeToStream = require('./writeToStream')
  , EE        = require('events').EventEmitter
  , inherits  = require('inherits')

function generate(packet) {
  var stream = new Accumulator()
  writeToStream(packet, stream)
  return stream.concat()
}

function Accumulator() {
  this._array = new Array(20)
  this._i = 0
}

inherits(Accumulator, EE)

Accumulator.prototype.write = function (chunk) {
  this._array[this._i++] = chunk
  return true
};

Accumulator.prototype.concat = function () {
  var length = 0
    , lengths = new Array(this._array.length)
    , list = this._array
    , pos = 0
    , i
    , result;

  for (i = 0; i < list.length && list[i]; i++) {
    if (typeof list[i] !== 'string') {
      lengths[i] = list[i].length;
    } else {
      lengths[i] = Buffer.byteLength(list[i]);
    }
    length += lengths[i];
  }

  result = new Buffer(length);

  for (i = 0; i < list.length && list[i]; i++) {
    if (typeof list[i] !== 'string') {
      list[i].copy(result, pos);
      pos += lengths[i];
    } else {
      result.write(list[i], pos);
      pos += lengths[i];
    }
  }

  return result;
};

module.exports = generate
