module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/follows.json',
  'type': 'object',
  'title': 'Follows',
  'description': ' A list of data subscriptions.',
  'required': [
    'type',
    'urls'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'description': "The object's type",
      'const': 'unwalled.garden/follows'
    },
    'urls': {
      'type': 'array',
      'description': 'The followed URLs',
      'items': {
        'type': 'string',
        'format': 'uri',
        'examples': [
          'dat://beakerbrowser.com'
        ]
      }
    }
  },
  'additionalProperties': false
}