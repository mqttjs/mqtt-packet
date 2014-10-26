mqtt-packet
===========

Encode and Decode MQTT packets the node way.

  * <a href="#installtion">Installation</a>
  * <a href="#examples">Examples</a>
  * <a href="#packets">Packets</a>
  * <a href="#api">API</a>
  * <a href="#licence">Licence &amp; copyright</a>

Acknowledgements
----------------

This library has been extracted and refactored from
[MQTT.js](http://github.com/adamvr/MQTT.js). Thanks [Adam Rudd](http://github.com/adamvr) for the great module.


## Installation

```bash
npm install mqemitter --save
```

Examples
--------

### Generating:

```js
var mqtt    = require('mqtt-packet')
  , object  = {
        cmd: 'publish'
      , retain: false
      , qos: 0
      , dup: false
      , length: 10
      , topic: 'test'
      , payload: 'test'
    }

console.log(mqtt.generate(object))
// prints
// <Buffer 30 0a 00 04 74 65 73 74 74 65 73 74>
//
// the same as
//
// new Buffer([
//   48, 10, // Header
//   0, 4, // Topic length
//   116, 101, 115, 116, // Topic (test)
//   116, 101, 115, 116 // Payload (test)
// ])
```

### Parsing:

```js
var mqtt      = require('mqtt-packet')
  , parser    = mqtt.parser()

// synchronously emits all the parsed packets
parser.on('packet', function(packet) {
  console.log(packet)
  // prints:
  //
  // {
  //     cmd: 'publish'
  //   , retain: false
  //   , qos: 0
  //   , dup: false
  //   , length: 10
  //   , topic: 'test'
  //   , payload: 'test'
  // }
})

parser.parse(new Buffer([
  48, 10, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  116, 101, 115, 116 // Payload (test)
])
// returns the number of bytes left in the parser
```

### Streams

```js
var mqtt      = require('mqtt-packet')
  , assert    = require('assert')
  , parser    = mqtt.parseStream()
  , generator = mqtt.generateStream()
  , object  = {
        cmd: 'publish'
      , retain: false
      , qos: 0
      , dup: false
      , length: 10
      , topic: 'test'
      , payload: 'test'
    }

generator.pipe(parser)

parser.on('data', function(packet) {
  assert.deepEqual(packet, object, 'expected packet')
})

generator.end(object)
```

### Duplex Wrapper

```js
var mqtt        = require('mqtt-packet')
  , assert      = require('assert')
  , through     = require('through2')
  , connection  = mqtt.connection(through())
  , object      = {
        cmd: 'publish'
      , retain: false
      , qos: 0
      , dup: false
      , length: 10
      , topic: 'test'
      , payload: 'test'
    }

connection.on('data', function(packet) {
  assert.deepEqual(packet, object, 'expected packet')
})

connection.end(object)
```

API
---

  * <a href="#generate"><code>mqtt#<b>generate()</b></code></a>
  * <a href="#parser"><code>mqtt#<b>parser()</b></code></a>
  * <a href="#generateStream"><code>mqtt#<b>generateStream()</b></code></a>
  * <a href="#parseStream"><code>mqtt#<b>parseStream()</b></code></a>
  * <a href="#connection"><code>mqtt#<b>connection</b></code></a>

<a name="generate">
### mqtt.generate(object)

Generates a `Buffer` containing an MQTT packet.
The object must be one of the ones specified by the [packets](#packets)
section. Throws an `Error` if a packet cannot be generated.

<a name="parser">
### mqtt.parser(opts)

Returns a new `Parser` object. `Parser` inherits from `EventEmitter` and
will emit:

  * `packet`, when a new packet is parsed, according to
    [packets](#packets)
  * `error`, if an error happens

The only allowed option is `{ encoding: 'binary' }` which will block the
automatic parsing of all the strings in the package. Instead, the
strings will remain 'raw', i.e. a `Buffer`.

<a name="parse">
#### Parser.parse(buffer)

Parse a given `Buffer` and emits synchronously all the MQTT packets that
are included. Returns the number of bytes left to parse.

<a name="generateStream">
### mqtt.generateStream()

Returns a `Transform` stream that calls [`generate()`](#generate).
The stream is configured into object mode.

<a name="parseStream">
### mqtt.parseStream(opts)

Returns a `Transform` stream that embeds a `Parser` and calls [`Parser.parse()`](#parse)
for each new `Buffer`. The stream is configured into object mode. It
accepts the same options of [`parser(opts)`](#parser).

<a name="connection">
### mqtt.connection(duplex, opts)

Wraps a duplex using [`reduplexer`](http://npm.im/reduplexer) so that
the user can both write and read an object, as defined in [packets](#packets).
It accepts the same options of [`parser(opts)`](#parser).

Packets
-------

License
-------

MIT
