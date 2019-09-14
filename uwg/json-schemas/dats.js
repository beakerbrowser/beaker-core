module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/dats.json',
  'type': 'object',
  'title': 'Dats',
  'description': 'A list of dats.',
  'required': [
    'type',
    'dats'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'description': "The object's type",
      'const': 'unwalled.garden/dats'
    },
    'dats': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['key'],
        'properties': {
          'key': {
            'type': 'string',
            'pattern': '^[0-9a-f]{64}$'
          },
          'title': {
            'type': 'string'
          },
          'description': {
            'type': 'string'
          },
          'type': {
            'type': ['string', 'array'],
            'items': {
              'type': 'string'
            }
          }
        }
      }
    }
  }
}