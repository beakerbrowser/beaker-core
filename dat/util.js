exports.normalizeFilepath = str => {
  str = decodeURIComponent(str || "")
  if (str.charAt(0) !== "/") {
    str = "/" + str
  }
  return str
}
