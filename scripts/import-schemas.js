const path = require('path')
const fs = require('fs')
const childProcess = require('child_process')
const rimraf = require('rimraf')

const SCHEMAS = [
  'comment',
  'follows',
  'post',
  'bookmark',
  'reaction'
]

console.log('')
console.log('Cloning unwalled.garden')
console.log('')
var tmpdir = fs.mkdtempSync('unwalled-garden-')
childProcess.execSync(`git clone https://github.com/beakerbrowser/unwalled.garden ${tmpdir}`)

console.log('')
console.log('Copying schema definitions')
console.log('')
for (let name of SCHEMAS) {
  console.log(name)
  var content = fs.readFileSync(path.join(tmpdir, name + '.json'))
  fs.writeFileSync(path.join(__dirname, '../crawler/json-schemas/', name + '.js'), `module.exports = ${content}`)
}

console.log('')
console.log('Removing tmpdir')
console.log('')
rimraf.sync(tmpdir)

console.log('Done!')
