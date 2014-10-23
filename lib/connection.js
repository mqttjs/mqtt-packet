
var generateStream = require('./generateStream')
  , parseStream    = require('./parseStream')
  , reduplexer     = require('reduplexer')

function connection(duplex, opts) {
  var result    = reduplexer(null, null, { objectMode: true })
    , inStream  = generateStream()
    , outStream = parseStream(opts)

  duplex.pipe(outStream)
  inStream.pipe(duplex)

  result.hookReadable(outStream)
  result.hookWritable(inStream)

  return result
}

module.exports = connection
