export const testCards = {
  'hola': {
    id: 'hola',
    source: 'hola',
    translation: 'hello',
    example: 'Hola, ¿cómo estás?',
    notes: 'Common greeting',
    tags: ['greeting'],
    created: '2025-01-01T00:00:00Z',
  },
  'gato': {
    id: 'gato',
    source: 'gato',
    translation: 'cat',
    example: 'El gato está durmiendo.',
    tags: ['animal'],
    created: '2025-01-01T00:00:00Z',
    reversible: true,
  },
  'perro': {
    id: 'perro',
    source: 'perro',
    translation: 'dog',
    tags: ['animal'],
    created: '2025-01-02T00:00:00Z',
  },
  'casa': {
    id: 'casa',
    source: 'casa',
    translation: 'house',
    created: '2025-01-03T00:00:00Z',
  },
  'agua': {
    id: 'agua',
    source: 'agua',
    translation: 'water',
    created: '2025-01-04T00:00:00Z',
  },
};

export const testCardsJson = JSON.stringify(testCards, null, 2);
