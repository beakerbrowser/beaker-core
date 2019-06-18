module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/media.json',
  'type': 'object',
  'title': 'media',
  'description': 'A published item of content.',
  'required': [
    'type',
    'subtype',
    'href',
    'title',
    'createdAt'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'const': 'unwalled.garden/media'
    },
    'subtype': {
      'type': 'string'
    },
    'href': {
      'type': 'string',
      'format': 'uri'
    },
    'title': {
      'type': 'string'
    },
    'description': {
      'type': 'string'
    },
    'tags': {
      'type': 'array',
      'items': {
        'type': 'string',
        'maxLength': 100,
        'pattern': '^[A-Za-z][A-Za-z0-9-_?]*$'
      }
    },
    'createdAt': {
      'type': 'string',
      'format': 'date-time'
    },
    'updatedAt': {
      'type': 'string',
      'format': 'date-time'
    },
    'ext': {
      'type': 'object'
    }
  }
}