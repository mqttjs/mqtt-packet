mqtt-packet&nbsp;&nbsp;&nbsp;[![Build Status](https://travis-ci.org/mcollina/mqtt-packet.png)](https://travis-ci.org/mcollina/mqtt-packet)
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
npm install mqtt-packet --save
```

Examples
--------

### Generating

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

### Parsing

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

API
---

  * <a href="#generate"><code>mqtt#<b>generate()</b></code></a>
  * <a href="#parser"><code>mqtt#<b>parser()</b></code></a>

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

Packets
-------

This section describes the format of all packets emitted by the `Parser`
and that you can input to `generate`.

### Connect

```js
{
    cmd: 'connect'
  , protocolId: 'MQTT' // or 'MQIsdp' in MQTT 3.1.1
  , protocolVersion: 4 // or 3 in MQTT 3.1
  , clean: true // or false
  , clientId: 'my-device'
  , keepalive: 0 // seconds, 0 is the default, can be any positive number
  , username: 'matteo'
  , password: 'collina'
  , will: {
        topic: 'mydevice/status'
      , payload: 'dead'
    }
}
```

The only mandatory argument is `clientId`, as `generate` will throw if
missing.

### Connack

```js
{
    cmd: 'connack'
  , returnCode: 0 // or whatever else you see fit
}
```

The only mandatory argument is `returnCode`, as `generate` will throw if
missing.

### Subscribe

```js
{
    cmd: 'subscribe'
  , messageId: 42
  , subscriptions: [{
        topic: 'test'
      , qos: 0
    }]
}
```

All properties are mandatory.

### Suback

```js
{
    cmd: 'suback'
  , messageId: 42
  , granted: [0, 1, 2, 128]
}
```

All the granted qos __must__ be < 256, as they are encoded as UInt8.
All properties are mandatory.

### Unsubscribe

```js
{
    cmd: 'unsubscribe'
  , messageId: 42
  , unsubscriptions: [
        'test'
      , 'a/topic'
    ]
}
```

All properties are mandatory.

### Unsuback

```js
{
    cmd: 'unsuback'
  , messageId: 42
}
```

All properties are mandatory.

### Publish

```js
{
    cmd: 'publish'
  , messageId: 42
  , qos: 2
  , dup: false
  , topic: 'test'
  , payload: 'test'
  , retain: false
}
```

Only the `topic` and properties are mandatory
Both `topic` and `payload` can be `Buffer` objects instead of strings.
`messageId` is mandatory for `qos > 0`.

### Puback

```js
{
    cmd: 'puback'
  , messageId: 42
}
```

The only mandatory argument is `messageId`, as `generate` will throw if
missing.

### Pubrec

```js
{
    cmd: 'pubcomp'
  , messageId: 42
}
```

The only mandatory argument is `messageId`, as `generate` will throw if
missing.

### Pubrel

```js
{
    cmd: 'pubrel'
  , messageId: 42
}
```

The only mandatory argument is `messageId`, as `generate` will throw if
missing.

### Pubcomp

```js
{
    cmd: 'pubcomp'
  , messageId: 42
}
```

The only mandatory argument is `messageId`, as `generate` will throw if
missing.

### Pingreq

```js
{
  cmd: 'pingreq'
}
```

### Pingresp

```js
{
  cmd: 'pingresp'
}
```

### Disconnect

```js
{
  cmd: 'pingresp'
}
```

License
-------

MIT
