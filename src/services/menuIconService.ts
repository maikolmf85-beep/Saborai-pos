import { MenuItem } from '../types';

const normalize = (value: string) => value
  .toLocaleLowerCase('es-CR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const matches = (text: string, terms: string[]) => terms.some(term => text.includes(term));

/** Devuelve el icono configurado por el restaurante o uno contextual si usa el genérico. */
export function getMenuItemIcon(item: Pick<MenuItem, 'name' | 'description' | 'category' | 'subcategory' | 'station' | 'imageIcon' | 'iconManual'>): string {
  const configured = item.imageIcon?.trim();
  if (configured && (item.iconManual || (configured !== '🍽️' && configured !== '🍴'))) return configured;

  const text = normalize([
    item.name,
    item.description,
    item.category,
    item.subcategory || '',
    item.station
  ].join(' '));

  if (matches(text, ['coctel', 'cocktail', 'mojito', 'margarita', 'daiquiri', 'piña colada', 'pina colada', 'martini'])) return '🍹';
  if (matches(text, ['cerveza', 'birra', 'lager', 'ipa', 'pilsen', 'stout', 'ale'])) return '🍺';
  if (matches(text, ['vino', 'copa de vino', 'sangria', 'sangría'])) return '🍷';
  if (matches(text, ['whisky', 'whiskey', 'ron', 'tequila', 'vodka', 'licor', 'traguito'])) return '🥃';
  if (matches(text, ['cafe', 'café', 'espresso', 'latte', 'capuccino', 'cappuccino', 'americano', 'te ', 'té ', 'infusion'])) return '☕';
  if (matches(text, ['batido', 'smoothie', 'milkshake', 'granizado', 'frozen', 'frappe', 'frappé'])) return '🥤';
  if (matches(text, ['jugo', 'zumo', 'refresco', 'gaseosa', 'soda', 'limonada', 'bebida', 'agua', 'drink'])) return '🥤';
  if (matches(text, ['pizza', 'calzone'])) return '🍕';
  if (matches(text, ['hamburgues', 'burger', 'cheeseburger'])) return '🍔';
  if (matches(text, ['taco', 'burrito', 'quesadilla', 'nacho', 'fajita'])) return '🌮';
  if (matches(text, ['sushi', 'sashimi', 'roll'])) return '🍣';
  if (matches(text, ['ceviche', 'pescado', 'salmon', 'salmón', 'camaron', 'camarón', 'marisco'])) return '🐟';
  if (matches(text, ['rib eye', 'ribeye', 'entrecot', 'filete', 'steak', 'chuleta', 'lomo', 'tomahawk', 'picanha', 'sirloin', 'carne'])) return '🥩';
  if (matches(text, ['pollo', 'alitas', 'nugget', 'wings'])) return '🍗';
  if (matches(text, ['ensalada', 'salad'])) return '🥗';
  if (matches(text, ['sopa', 'crema', 'caldo'])) return '🥣';
  if (matches(text, ['pasta', 'lasagna', 'lasaña', 'espagueti', 'ravioli'])) return '🍝';
  if (matches(text, ['postre', 'pastel', 'queque', 'torta', 'brownie', 'cheesecake', 'dulce'])) return '🍰';
  if (matches(text, ['helado', 'sorbete'])) return '🍨';
  if (item.station === 'Bar') return '🍹';
  if (item.station === 'Postres') return '🍰';
  if (matches(text, ['papas', 'papitas', 'patacon', 'patacón', 'yuca', 'aros de cebolla'])) return '🍟';
  return '🍽️';
}
