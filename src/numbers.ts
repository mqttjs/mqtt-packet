import { Buffer } from 'buffer'

const max: number = 65536
const cache: { [key: number]: Buffer } = {}

// in node 6 Buffer.subarray returns a Uint8Array instead of a Buffer
// later versions return a Buffer
// alternative is Buffer.slice but that creates a new buffer
// creating new buffers takes time
// SubOk is only false on node < 8
const SubOk: boolean = Buffer.isBuffer(Buffer.from([1, 2]).subarray(0, 1))

function generateBuffer(i: number): Buffer {
	const buffer: Buffer = Buffer.allocUnsafe(2)
	buffer.writeUInt8(i >> 8, 0)
	buffer.writeUInt8(i & 0x00ff, 1)

	return buffer
}

function generateCache(): void {
	for (let i: number = 0; i < max; i++) {
		cache[i] = generateBuffer(i)
	}
}

function genBufVariableByteInt(num: number): Buffer {
	const maxLength: number = 4 // max 4 bytes
	let digit: number = 0
	let pos: number = 0
	const buffer: Buffer = Buffer.allocUnsafe(maxLength)

	do {
		digit = num % 128 | 0
		num = (num / 128) | 0
		if (num > 0) digit |= 0x80

		buffer.writeUInt8(digit, pos++)
	} while (num > 0 && pos < maxLength)

	if (num > 0) {
		pos = 0
	}

	return SubOk ? buffer.subarray(0, pos) : buffer.slice(0, pos)
}

function generate4ByteBuffer(num: number): Buffer {
	const buffer: Buffer = Buffer.allocUnsafe(4)
	buffer.writeUInt32BE(num, 0)
	return buffer
}

export default {
	cache,
	generateCache,
	generateNumber: generateBuffer,
	genBufVariableByteInt,
	generate4ByteBuffer,
}
