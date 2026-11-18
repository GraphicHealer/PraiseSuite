import { StreamLanguage } from "@codemirror/language";

/**
 * OpenSong lyric notation highlighting:
 *   [V1](L;L1=en)  section headers + options
 *   . C  G  F      chord lines
 *   ; comment      comments
 *   -!! / -__      directives
 *   1-9            verse-number column
 *   | ||           break markers
 */
export const opensongLanguage = StreamLanguage.define<Record<string, never>>({
  name: "opensong",
  token(stream) {
    if (stream.sol()) {
      if (stream.match(/^\[[^\]]*\](\([^)]*\))?/)) return "keyword";
      if (stream.eat(".")) {
        stream.skipToEnd();
        return "number";
      }
      if (stream.eat(";")) {
        stream.skipToEnd();
        return "lineComment";
      }
      if (stream.eat("-")) {
        stream.skipToEnd();
        return "meta";
      }
      if (stream.match(/^[1-9]/)) return "tagName";
    }
    if (stream.match(/\|\|?/)) return "operator";
    stream.next();
    return null;
  },
  languageData: {},
});
