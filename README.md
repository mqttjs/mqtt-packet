mqtt-packet
===========

Encode and Decode MQTT packets the node way.

Acknowledgements
----------------

This library has been extracted and refactored from
[MQTT.js](http://github.com/adamvr/MQTT.js). Thanks [Adam Rudd](http://github.com/adamvr) for the great module.

Examples
--------

Generating:

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

Parsing:

```js

var mqtt      = require('mqtt-packet')
  , parser    = mqtt.parser(opts)

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

License
-------

MIT
