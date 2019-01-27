module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/published-site.json',
  'type': 'object',
  'title': 'Published site',
  'description': 'A site which has been published by the user.',
  'required': [
    'type',
    'url',
    'createdAt'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'title': "The object's type",
      'const': 'unwalled.garden/published-sites'
    },
    'url': {
      'type': 'string',
      'title': "The published site's URL",
      'format': 'uri',
      'examples': [
        'dat://beakerbrowser.com'
      ]
    },
    'createdAt': {
      'type': 'string',
      'format': 'date-time',
      'title': "The time of this site's publishing"
    }
  },
  'additionalProperties': false
}