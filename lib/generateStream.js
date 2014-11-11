
var through   = require('through2')
  , generate  = require('./generate')
  , empty     = new Buffer(0)

function generateStream() {
  return through.obj(process)
}

function process(chunk, enc, cb) {
  var packet = empty;

  try {
    packet = generate(chunk)
  } catch(err) {
    this.emit('error', err)
    return;
  }

  this.push(packet)
  cb()
}

module.exports = generateStream;
