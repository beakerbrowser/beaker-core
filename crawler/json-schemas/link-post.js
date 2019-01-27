module.exports = {
  '$schema': 'http://json-schema.org/draft-07/schema#',
  '$id': 'dat://unwalled.garden/link-post.json',
  'type': 'object',
  'title': 'Link Post',
  'description': 'A published link to some content.',
  'required': [
    'type',
    'content',
    'createdAt'
  ],
  'properties': {
    'type': {
      'type': 'string',
      'title': "The object's type",
      'const': 'unwalled.garden/link-post'
    },
    'content': {
      'type': 'object',
      'required': [
        'url',
        'title'
      ],
      'properties': {
        'url': {
          'type': 'string',
          'title': "The post's target URL",
          'format': 'uri',
          'examples': [
            'dat://beakerbrowser.com'
          ]
        },
        'title': {
          'type': 'string'
        },
        'description': {
          'type': 'string'
        },
        'type': {
          'type': 'array',
          'items': {
            'type': 'string'
          }
        }
      }
    },
    'createdAt': {
      'type': 'string',
      'format': 'date-time',
      'title': "The time of this post's creation"
    },
    'updatedAt': {
      'type': 'string',
      'format': 'date-time',
      'title': "The time of this post's last edit"
    }
  },
  'additionalProperties': false
}