const MarkdownIt = require('markdown-it')

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

exports.render = function (nav, content) {
  return `
<html>
  <head>
    <style>
      body {
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, Cantarell, "Oxygen Sans", "Helvetica Neue", sans-serif;
        font-size: 14px;
        width: 100%;
        line-height: 22.5px;
      }
      main {
        flex: 1;
        max-width: 860px;
        margin: 0 auto;
      }
      nav {
        max-width: 200px;
        padding-right: 4em;
        overflow: hidden;
        margin: 0.5em 0;
      }
      @media (min-width: 1300px) {
        nav {
          position: fixed; /* on wide screens, dont cause the <main> to be offset at all */
        }
      }
      hr {
        border: 0;
        border-top: 1px solid #ccc;
        margin: 1em 0;
      }
      blockquote {
        margin: 0;
        padding: 0 1em;
        border-left: 1em solid #eee;
      }
      table {
        border-collapse: collapse;
      }
      td, th {
        padding: 0.5em 1em;
      }
      tbody tr:nth-child(odd) {
        background: #fafafa;
      }
      tbody td {
        border-top: 1px solid #bbb;
      }
      a {
        color: #2864dc;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      h1, h2,  h3 {
        margin: 15px 0;
        font-weight: 600;
      }
      h1, h2 {
        border-bottom: 1px solid #eee;
        line-height: 45px;
      }
      h1 {
        font-size: 30px;
      }
      h2 {
        font-size: 24px;
      }
      h3 {
        font-size: 20px;
      }
      ul, ol {
        margin-bottom: 15px;
      }
      pre, code {
        font-family: Consolas, 'Lucida Console', Monaco, monospace;
        font-size: 13.5px;
        background: #f0f0f0;
        border-radius: 2px;
      }
      pre {
        padding: 15px;
        border: 0;
        overflow-x: auto;
      }
      code {
        padding: 3px 5px;
      }
      pre > code {
        display: block;
      }
    </style>
  </head>
  <body>
    ${nav ? `<nav>${md.render(nav)}</nav>` : ''}
    <main>${md.render(content)}</main>
  </body>
</html>
  `
}
