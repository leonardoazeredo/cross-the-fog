package codes.madera.crossfog.link

/**
 * A strict RFC 8259 check of one JSON object, run before org.json builds anything. Android's org.json
 * is looser than the JVM artifact the tests run on (it skips comments and `#` lines, reads `0x1` and
 * `01` as numbers, reads `-0` as 0 and lets a later duplicate key win), so what it would accept is decided here, once,
 * the same on every device. Nesting is capped, so no input can exhaust the stack.
 */
internal class StrictJson private constructor(private val s: String) {
  private var i = 0

  companion object {
    const val MAX_DEPTH = 8
    const val MAX_NUMBER_CHARS = 64

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
      '"' -> string(keep = false)
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
      if (!keys.add(string(keep = true))) throw notJson()
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

  /**
   * Reads a string. Its decoded text is built only for a key (`keep`), which is what a duplicate is
   * judged on; a value is a track that can be megabytes, and checking it needs no copy.
   */
  private fun string(keep: Boolean): String {
    expect('"')
    val out = StringBuilder()
    var highSurrogate = false
    while (true) {
      if (i >= s.length) throw notJson()
      val c = s[i++]
      when {
        c == '"' -> {
          if (highSurrogate) throw notJson()
          return out.toString()
        }
        c < ' ' -> throw notJson()
        // A high surrogate escape must be followed at once by a low one, and a low one needs a high before it:
        // an unpaired one cannot be written as UTF-8 and would come back as "?".
        highSurrogate && c != '\\' -> throw notJson()
        c != '\\' -> if (keep) out.append(c)
        else -> {
          if (i >= s.length) throw notJson()
          val e = s[i++]
          if (highSurrogate && e != 'u') throw notJson()
          when (e) {
            '"', '\\', '/' -> if (keep) out.append(e)
            'b' -> if (keep) out.append('\b')
            'f' -> if (keep) out.append('\u000c')
            'n' -> if (keep) out.append('\n')
            'r' -> if (keep) out.append('\r')
            't' -> if (keep) out.append('\t')
            'u' -> {
              if (i + 4 > s.length) throw notJson()
              var code = 0
              repeat(4) {
                // Character.digit also takes other scripts' digits and fullwidth letters; JSON allows ASCII only.
                val ch = s[i++]
                val d = when (ch) {
                  in '0'..'9' -> ch - '0'
                  in 'a'..'f' -> ch - 'a' + 10
                  in 'A'..'F' -> ch - 'A' + 10
                  else -> throw notJson()
                }
                code = code * 16 + d
              }
              val unit = code.toChar()
              if (Character.isLowSurrogate(unit) != highSurrogate) throw notJson()
              highSurrogate = Character.isHighSurrogate(unit)
              if (keep) out.append(unit)
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
    val start = i
    if (peek() == '-') i++
    if (peek() == '0') i++ else if (digits() == 0) throw notJson()
    if (peek() == '.') { i++; if (digits() == 0) throw notJson() }
    if (peek() == 'e' || peek() == 'E') {
      i++
      if (peek() == '+' || peek() == '-') i++
      if (digits() == 0) throw notJson()
    }
    if (i - start > MAX_NUMBER_CHARS) throw notJson()
    // Android's org.json refuses a number past double range and the JVM one takes it, whatever its shape.
    if (s.substring(start, i).toDouble().isInfinite()) throw notJson()
    // Android's org.json reads the integer `-0` as 0 and the JVM one as a double, so a field of that value would be refused differently.
    if (i - start == 2 && s[start] == '-' && s[start + 1] == '0') throw notJson()
  }
}
