
var generateStream = require('./generateStream')
  , parseStream    = require('./parseStream')
  , reduplexer     = require('reduplexer')

function connection(duplex, opts) {
  var inStream  = generateStream()
    , outStream = parseStream(opts)

  duplex.pipe(outStream)
  inStream.pipe(duplex)

  return reduplexer(inStream, outStream, { objectMode: true })
}

module.exports = connection
