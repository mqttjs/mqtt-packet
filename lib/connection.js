
var generateStream = require('./generateStream')
  , parseStream    = require('./parseStream')
  , Reduplexer     = require('reduplexer')
  , inherits       = require('inherits')

function Connection(duplex, opts) {
  if (!(this instanceof Connection)) {
    return new Connection(duplex, opts)
  }

  var inStream  = generateStream()
    , outStream = parseStream(opts)

  duplex.pipe(outStream)
  inStream.pipe(duplex)

  this._duplex = duplex

  Reduplexer.call(this, inStream, outStream, { objectMode: true })
}

inherits(Connection, Reduplexer)

Connection.prototype.destroy = function() {
  if (this._duplex.destroy)
    this._duplex.destroy()
  else
    this._duplex.end()
}

module.exports = Connection
