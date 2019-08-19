const path = require('path')
const fs = require('fs')
const detectSparseFiles = require('supports-sparse-files')
const raf = require('random-access-file')
const raif = require('random-access-indexed-file')
const logger = require('./logger').child({category: 'dat', subcategory: 'storage'})

// globals
// =

const LARGE_FILES = ['data', 'signatures']
const INDEX_BLOCK_SIZE = {
  data: 1024 * 1024, // 1mb
  signatures: 1024 // 1kb
}
var supportsSparseFiles = false

// exported api
// =

exports.setup = async function () {
  await new Promise((resolve) => {
    detectSparseFiles(function (err, yes) {
      supportsSparseFiles = yes
      if (!yes) {
        logger.info('Sparse-file support not detected. Falling back to indexed data files.')
      }
      resolve()
    })
  })
}

function createStorage (folder, subfolder) {
  return function (name) {
    var filepath = path.join(folder, subfolder, name)
    if (fs.existsSync(filepath + '.index')) {
      // use random-access-indexed-file because that's what has been used
      return raif(filepath, {blockSize: INDEX_BLOCK_SIZE[name]})
    }
    if (!supportsSparseFiles && LARGE_FILES.includes(name)) {
      // use random-access-indexed-file because sparse-files are not supported and this file tends to get big
      return raif(filepath, {blockSize: INDEX_BLOCK_SIZE[name]})
    }
    return raf(filepath)
  }
}

exports.create = function (folder) {
  return {
    metadata: createStorage(folder, 'metadata'),
    content: createStorage(folder, 'content')
  }
}