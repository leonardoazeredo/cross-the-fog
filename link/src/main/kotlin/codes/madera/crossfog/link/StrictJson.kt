package codes.madera.crossfog.link

/**
 * A strict RFC 8259 check of one JSON object, run before org.json builds anything. Android's org.json
 * is looser than the JVM artifact the tests run on (it skips comments and `#` lines, reads `0x1` and
 * `01` as numbers and lets a later duplicate key win), so what it would accept is decided here, once,
 * the same on every device. Nesting is capped, so no input can exhaust the stack.
 */
internal class StrictJson private constructor(private val s: String) {
  private var i = 0

  companion object {
    const val MAX_DEPTH = 8

    /** Returns normally for exactly one object and nothing after it; throws [ProtocolException] otherwise. */
    fun requireObject(text: String) {
      val c = StrictJson(text)
      c.skipSpace()
      if (c.peek() != '{') throw notJson()
      c.value(1)
      c.skipSpace()
      if (c.i != text.length) throw notJson()
    }

    private fun notJson() = ProtocolException(ProtocolError.NOT_A_JSON_OBJECT)
  }

  private fun peek(): Char = if (i < s.length) s[i] else '\u0000'

  private fun skipSpace() {
    while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
  }

  private fun expect(c: Char) {
    if (i >= s.length || s[i] != c) throw notJson()
    i++
  }

  private fun value(depth: Int) {
    if (depth > MAX_DEPTH) throw ProtocolException(ProtocolError.NESTED_TOO_DEEPLY)
    when (peek()) {
      '{' -> obj(depth)
      '[' -> array(depth)
      '"' -> string()
      't' -> literal("true")
      'f' -> literal("false")
      'n' -> literal("null")
      else -> number()
    }
  }

  private fun obj(depth: Int) {
    expect('{')
    skipSpace()
    val keys = HashSet<String>()
    if (peek() == '}') { i++; return }
    while (true) {
      skipSpace()
      if (peek() != '"') throw notJson()
      if (!keys.add(string())) throw notJson()
      skipSpace()
      expect(':')
      skipSpace()
      value(depth + 1)
      skipSpace()
      when (peek()) {
        ',' -> i++
        '}' -> { i++; return }
        else -> throw notJson()
      }
    }
  }

  private fun array(depth: Int) {
    expect('[')
    skipSpace()
    if (peek() == ']') { i++; return }
    while (true) {
      skipSpace()
      value(depth + 1)
      skipSpace()
      when (peek()) {
        ',' -> i++
        ']' -> { i++; return }
        else -> throw notJson()
      }
    }
  }

  /** Reads a string and returns its decoded text, which is what a duplicate key is judged on. */
  private fun string(): String {
    expect('"')
    val out = StringBuilder()
    while (true) {
      if (i >= s.length) throw notJson()
      val c = s[i++]
      when {
        c == '"' -> return out.toString()
        c < ' ' -> throw notJson()
        c != '\\' -> out.append(c)
        else -> {
          if (i >= s.length) throw notJson()
          when (val e = s[i++]) {
            '"', '\\', '/' -> out.append(e)
            'b' -> out.append('\b')
            'f' -> out.append('\u000c')
            'n' -> out.append('\n')
            'r' -> out.append('\r')
            't' -> out.append('\t')
            'u' -> {
              if (i + 4 > s.length) throw notJson()
              var code = 0
              repeat(4) {
                val d = Character.digit(s[i++], 16)
                if (d < 0) throw notJson()
                code = code * 16 + d
              }
              out.append(code.toChar())
            }
            else -> throw notJson()
          }
        }
      }
    }
  }

  private fun literal(word: String) {
    if (!s.startsWith(word, i)) throw notJson()
    i += word.length
  }

  private fun digits(): Int {
    val start = i
    while (i < s.length && s[i] in '0'..'9') i++
    return i - start
  }

  private fun number() {
    if (peek() == '-') i++
    if (peek() == '0') i++ else if (digits() == 0) throw notJson()
    if (peek() == '.') { i++; if (digits() == 0) throw notJson() }
    if (peek() == 'e' || peek() == 'E') {
      i++
      if (peek() == '+' || peek() == '-') i++
      if (digits() == 0) throw notJson()
    }
  }
}
