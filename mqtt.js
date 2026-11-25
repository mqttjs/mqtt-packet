import Parser from './parser.js'
import generate from './generate.js'
import writeToStream from './writeToStream.js'
import constants from './constants.js'

export const parser = Parser.parser
export { generate, writeToStream }

export const parserErrorCodes = constants.parserErrorCodes

export default {
  parser,
  generate,
  writeToStream,
  parserErrorCodes
}
