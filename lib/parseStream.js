
var through = require('through2')
  , build   = require('./parser')

function parseStream(opts) {
  var parser  = build(opts)
    , stream  = through.obj(process)

  parser.on('packet', push)

  function process(chunk, enc, cb) {
    parser.parse(chunk)
    cb();
  }

  function push(packet) {
    stream.push(packet)
  }

  return stream
}

module.exports = parseStream;
