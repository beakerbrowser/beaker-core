module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/vote.json',
  'type': 'object',
  'title': 'Vote',
  'description': 'A vote up or down on some resource.',
  'required': [
    'type',
    'topic',
    'vote',
    'createdAt'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'description': "The object's type",
      'const': 'unwalled.garden/vote'
    },
    'topic': {
      'type': 'string',
      'format': 'uri'
    },
    'vote': {
      'type': 'number',
      'enum': [-1, 1]
    },
    'createdAt': {
      'type': 'string',
      'format': 'date-time',
    },
    'updatedAt': {
      'type': 'string',
      'format': 'date-time'
    }
  }
}