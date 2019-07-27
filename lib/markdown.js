const MarkdownIt = require('markdown-it')
const emojiRegex = require('emoji-regex')

var md = MarkdownIt({
  html: true, // Enable HTML tags in source
  xhtmlOut: false, // Use '/' to close single tags (<br />)
  breaks: true, // Convert '\n' in paragraphs into <br>
  langPrefix: 'language-', // CSS language prefix for fenced blocks
  linkify: true, // Autoconvert URL-like text to links

  // Enable some language-neutral replacement + quotes beautification
  typographer: true,

  // Double + single quotes replacement pairs, when typographer enabled,
  // and smartquotes on. Set doubles to '«»' for Russian, '„“' for German.
  quotes: '“”‘’',

  // Highlighter function. Should return escaped HTML,
  // or '' if the source string is not changed
  highlight: function (/* str, lang */) { return '' }
})

// add IDs to headings
var numRepetitions = {}
md.renderer.rules.heading_open = function (tokens, idx /*, options, env */) {
  var txt = tokens[idx + 1].content || ''
  numRepetitions[txt] = (numRepetitions[txt]) ? numRepetitions[txt] + 1 : 0
  return '<' + tokens[idx].tag + ' id="' + anchorMarkdownHeader(txt, numRepetitions[txt]) + '">'
}

exports.render = function (content) {
  return `
<html>
  <body>
    <main>${md.render(content)}</main>
  </body>
</html>
  `
}

/**
https://github.com/thlorenz/anchor-markdown-header

Copyright 2013 Thorsten Lorenz.
All rights reserved.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
 */

 function basicGithubId (text) {
  return text.replace(/ /g, '-')
    // escape codes
    .replace(/%([abcdef]|\d){2,2}/ig, '')
    // single chars that are removed
    .replace(/[/?!:[\]`.,()*"';{}+=<>~$|#@&–—]/g, '')
    // CJK punctuations that are removed
    .replace(/[。？！，、；：“”【】（）〔〕［］﹃﹄“ ”‘’﹁﹂—…－～《》〈〉「」]/g, '')
}

function getGithubId (text, repetition) {
  text = basicGithubId(text)

  // If no repetition, or if the repetition is 0 then ignore. Otherwise append '-' and the number.
  if (repetition) {
    text += '-' + repetition
  }

  // Strip emojis
  text = text.replace(emojiRegex(), '')

  return text
}

/**
 * Generates an anchor for the given header and mode.
 *
 * @name anchorMarkdownHeader
 * @function
 * @param header      {String} The header to be anchored.
 * @param repetition  {Number} The nth occurrence of this header text, starting with 0. Not required for the 0th instance.
 * @return            {String} The header anchor id
 */
function anchorMarkdownHeader (header, repetition) {
  var replace
  var customEncodeURI = encodeURI

  replace = getGithubId
  customEncodeURI = function (uri) {
    var newURI = encodeURI(uri)

    // encodeURI replaces the zero width joiner character
    // (used to generate emoji sequences, e.g.Female Construction Worker 👷🏼‍♀️)
    // github doesn't URL encode them, so we replace them after url encoding to preserve the zwj character.
    return newURI.replace(/%E2%80%8D/g, '\u200D')
  }

  function asciiOnlyToLowerCase (input) {
    var result = ''
    for (var i = 0; i < input.length; ++i) {
      if (input[i] >= 'A' && input[i] <= 'Z') {
        result += input[i].toLowerCase()
      } else {
        result += input[i]
      }
    }
    return result
  }

  var href = replace(asciiOnlyToLowerCase(header.trim()), repetition)

  return customEncodeURI(href)
};