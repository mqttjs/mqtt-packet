import writeToStream from './writeToStream'
import { EventEmitter } from 'events'
import { Buffer } from 'buffer'

interface GenerateOptions {
	// Define the properties of opts if known
}

function generate(packet: any, opts?: GenerateOptions): Buffer {
	const stream = new Accumulator()
	writeToStream(packet, stream, opts)
	return stream.concat()
}

class Accumulator extends EventEmitter {
	private _array: (Buffer | string)[]

	private _i: number

	constructor() {
		super()
		this._array = new Array(20)
		this._i = 0
	}

	write(chunk: Buffer | string): boolean {
		this._array[this._i++] = chunk
		return true
	}

	concat(): Buffer {
		let length = 0
		const lengths: number[] = new Array(this._array.length)
		const list: (Buffer | string)[] = this._array
		let pos = 0

		for (let i = 0; i < list.length && list[i] !== undefined; i++) {
			lengths[i] =
				typeof list[i] !== 'string'
					? list[i].length
					: Buffer.byteLength(list[i])
			length += lengths[i]
		}

		const result: Buffer = Buffer.allocUnsafe(length)

		for (let i = 0; i < list.length && list[i] !== undefined; i++) {
			if (typeof list[i] !== 'string') {
				;(list[i] as Buffer).copy(result, pos)
				pos += lengths[i]
			} else {
				result.write(list[i] as string, pos)
				pos += lengths[i]
			}
		}

		return result
	}

	destroy(err?: Error): void {
		if (err) this.emit('error', err)
	}
}

export default generate
