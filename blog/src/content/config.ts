import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    category: z.enum(['noticias', 'tips', 'actualizaciones', 'industria', 'recetas-exito']),
    tags: z.array(z.string()).default([]),
    author: z.string().default('Equipo SaborAI'),
    readingTime: z.number().optional(),
    featured: z.boolean().default(false),
  }),
});

const guias = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    icon: z.string().default('📖'),
    category: z.enum(['primeros-pasos', 'facturacion', 'inventario', 'mesas', 'caja', 'cocina', 'ia', 'configuracion']),
    order: z.number().default(0),
    difficulty: z.enum(['basico', 'intermedio', 'avanzado']).default('basico'),
  }),
});

const ayuda = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    category: z.enum(['general', 'facturacion', 'pagos', 'impresion', 'cuenta', 'tecnico']),
    tags: z.array(z.string()).default([]),
    order: z.number().default(0),
  }),
});

const changelog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    version: z.string(),
    type: z.enum(['major', 'minor', 'patch']),
    highlights: z.array(z.string()).default([]),
  }),
});

export const collections = { blog, guias, ayuda, changelog };
