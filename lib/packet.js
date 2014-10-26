
function Packet() {
  if (!(this instanceof Packet)) {
    return new Packet()
  }

  this.cmd = null
  this.retain = false
  this.qos = 0
  this.dup = false
  this.length = -1
  this.protocolId = null
  this.protocolVersion = -1
  this.username = null
  this.password = null
  this.clean = false
  this.keepalive = -1
  this.clientId = null
  this.returnCode = -1
  this.topic = null
  this.payload = null
  this.subscriptions = null
  this.granted = null
  this.unsubscriptions = null
  this.messageId = -1
  this.will = null
}

module.exports = Packet
