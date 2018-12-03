'use strict'

const mqtt = require('../')

const max = 100000
let i
const payload = Buffer.from('test')

// initialize it
mqtt.generate({
  cmd: 'publish',
  topic: 'test',
  payload
})

const start = Date.now()
let time

for (i = 0; i < max; i++) {
  mqtt.generate({
    cmd: 'publish',
    topic: 'test',
    payload
  })
}

time = Date.now() - start
console.log('Total time', time)
console.log('Total packets', max)
console.log('Packet/s', max / time * 1000)
