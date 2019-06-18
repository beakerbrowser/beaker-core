module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/discussion.json',
  'type': 'object',
  'title': 'Discussion',
  'description': 'A forum discussion.',
  'required': ['type', 'title', 'createdAt'],
  'properties': {
    'type': {
      'type': 'string',
      'description': "The object's type",
      'const': 'unwalled.garden/discussion'
    },
    'title': {
      'type': 'string',
      'maxLength': 280
    },
    'body': {
      'type': 'string',
      'maxLength': 1000000
    },
    'href': {
      'type': 'string',
      'format': 'uri'
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
    }
  }
}