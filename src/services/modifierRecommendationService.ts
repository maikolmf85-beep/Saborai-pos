import { MenuItem } from '../types';

export interface QuickModifierRecommendation {
  label: string;
  reason: string;
  priority: number;
}

const normalize = (value: string) => value
  .toLocaleLowerCase('es-CR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const includesAny = (text: string, words: string[]) => words.some(word => text.includes(word));

/**
 * Recomendaciones instantáneas y deterministas para el POS.
 * La clasificación usa las señales disponibles del menú para no bloquear la comanda
 * esperando una llamada de red. Los modificadores configurados por el restaurante
 * siempre tienen prioridad sobre las sugerencias automáticas.
 */
export function getQuickModifierRecommendations(item: MenuItem): QuickModifierRecommendation[] {
  const text = normalize([
    item.name,
    item.description,
    item.category,
    item.subcategory || '',
    item.station,
    ...(item.ingredients || []).map(ingredient => ingredient.name)
  ].join(' '));

  const recommendations: QuickModifierRecommendation[] = [];
  const add = (label: string, reason: string, priority: number) => {
    if (!recommendations.some(recommendation => recommendation.label === label)) {
      recommendations.push({ label, reason, priority });
    }
  };

  const isDrink = item.station === 'Bar' || includesAny(text, [
    'bebida', 'refresco', 'gaseosa', 'soda', 'jugo', 'batido', 'smoothie', 'coctel',
    'cocktail', 'cerveza', 'vino', 'cafe', 'te ', 'limonada', 'frozen', 'milkshake',
    'frappe', 'granizado', 'daiquiri', 'mojito', 'margarita'
  ]);
  const isHotDrink = includesAny(text, ['cafe', 'espresso', 'capuccino', 'latte', 'te ', 'chocolate caliente']);
  const isColdDrink = isDrink && !isHotDrink;
  const isBurger = includesAny(text, ['hamburgues', 'burger', 'cheeseburger', 'sandwich', 'panini']);
  const isSteak = includesAny(text, ['rib eye', 'ribeye', 'entrecot', 'filete', 'steak', 'chuleta', 'lomo', 'corte', 'tomahawk', 'picanha', 'sirloin', 'new york']);
  const isPizza = includesAny(text, ['pizza', 'calzone']);
  const isSalad = includesAny(text, ['ensalada', 'salad']);
  const isMexican = includesAny(text, ['taco', 'burrito', 'quesadilla', 'nachos', 'fajita']);
  const isSeafood = includesAny(text, ['ceviche', 'camaron', 'camarones', 'pescado', 'marisco', 'salmon', 'atun']);
  const hasSauce = includesAny(text, ['salsa', 'aderezo', 'mayonesa', 'ketchup', 'bbq', 'chimichurri', 'guacamole']);

  if (isColdDrink) {
    add('Sin hielo', 'Bebida fría', 100);
    add('Poco hielo', 'Bebida fría', 95);
    add('Sin azúcar', 'Bebida fría', 90);
    add('Frozen', 'Bebida fría', 85);
  }
  if (isHotDrink) {
    add('Sin azúcar', 'Bebida caliente', 100);
    add('Leche deslactosada', 'Bebida caliente', 95);
    add('Leche vegetal', 'Bebida caliente', 90);
    add('Extra caliente', 'Bebida caliente', 85);
  }
  if (isBurger) {
    add('Sin cebolla', 'Hamburguesa o sándwich', 100);
    add('Sin pepinillos', 'Hamburguesa o sándwich', 95);
    add('Agregar queso', 'Hamburguesa o sándwich', 90);
    add('Salsa aparte', 'Hamburguesa o sándwich', 85);
  }
  if (isSteak) {
    add('Término rojo', 'Corte de carne', 100);
    add('Término medio', 'Corte de carne', 98);
    add('Término 3/4', 'Corte de carne', 95);
    add('Bien cocido', 'Corte de carne', 90);
    add('Salsa aparte', 'Corte de carne', 80);
  }
  if (isPizza) {
    add('Sin cebolla', 'Pizza', 95);
    add('Sin aceitunas', 'Pizza', 90);
    add('Extra queso', 'Pizza', 85);
    add('Salsa aparte', 'Pizza', 80);
  }
  if (isSalad) {
    add('Aderezo aparte', 'Ensalada', 100);
    add('Sin cebolla', 'Ensalada', 90);
    add('Sin crutones', 'Ensalada', 85);
  }
  if (isMexican) {
    add('Sin cebolla', 'Platillo mexicano', 95);
    add('Picante aparte', 'Platillo mexicano', 100);
    add('Guacamole extra', 'Platillo mexicano', 85);
    add('Salsa aparte', 'Platillo mexicano', 80);
  }
  if (isSeafood) {
    add('Sin cebolla', 'Platillo de mariscos', 90);
    add('Limón aparte', 'Platillo de mariscos', 95);
    add('Picante aparte', 'Platillo de mariscos', 85);
  }
  if (hasSauce && !isBurger && !isPizza && !isSalad) {
    add('Salsa aparte', 'Platillo con salsa o aderezo', 75);
  }

  // Fallback contextual: no mostramos términos de carne en bebidas o postres.
  if (recommendations.length === 0 && item.station === 'Postres') {
    add('Sin nueces', 'Postre', 90);
    add('Sin crema', 'Postre', 85);
    add('Para llevar', 'Postre', 70);
  }

  return recommendations.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

export function getConfiguredOrRecommendedModifiers(item: MenuItem): QuickModifierRecommendation[] {
  const configured = (item.modifiers || []).flatMap(modifier => modifier.choices.slice(0, 5).map(choice => ({
    label: choice.name,
    reason: modifier.name,
    priority: 110
  })));
  const automatic = getQuickModifierRecommendations(item);
  const combined = [...configured, ...automatic];
  return combined.filter((recommendation, index, list) => list.findIndex(candidate => candidate.label === recommendation.label) === index).slice(0, 5);
}
