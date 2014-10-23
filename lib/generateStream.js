
var through = require('through2')
  , generate = require('./generate')

function generateStream() {
  var stream  = through.obj(process)

  function process(chunk, enc, cb) {
    this.push(generate(chunk))
    cb()
  }

  return stream
}

module.exports = generateStream;
