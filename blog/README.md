# SaborAI Blog

Blog oficial de SaborAI POS — built with [Astro](https://astro.build) + Tailwind CSS.

## 🌐 URL de Producción
**https://blog.saborai.site**

## 🚀 Inicio Rápido

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo (localhost:4321)
npm run dev

# Build de producción
npm run build

# Preview del build
npm run preview
```

## 📁 Estructura del Proyecto

```
blog/
├── src/
│   ├── content/          # Contenido en Markdown/MDX
│   │   ├── blog/         # Artículos del blog (.md)
│   │   ├── guias/        # Guías de uso (.md)
│   │   ├── ayuda/        # Artículos del Centro de Ayuda (.md)
│   │   ├── changelog/    # Historial de versiones (.md)
│   │   └── config.ts     # Definición de colecciones
│   ├── layouts/
│   │   └── BaseLayout.astro  # Layout principal (nav, footer, SEO)
│   ├── pages/
│   │   ├── index.astro       # Home del blog
│   │   ├── blog/             # Listado y posts individuales
│   │   ├── guias/            # Listado y guías individuales
│   │   ├── ayuda/            # Centro de ayuda
│   │   ├── changelog/        # Historial de versiones
│   │   └── rss.xml.ts        # Feed RSS
│   └── styles/
│       └── global.css        # Estilos globales
├── public/
│   └── assets/
│       └── logos/            # Logos de SaborAI
├── astro.config.mjs          # Configuración de Astro
├── tailwind.config.mjs       # Configuración de Tailwind
└── vercel.json               # Configuración de despliegue
```

## ✍️ Cómo agregar contenido

### Nuevo artículo de blog

Crea un archivo `.md` en `src/content/blog/`:

```yaml
---
title: "Título del artículo"
description: "Descripción breve"
pubDate: 2026-10-01
heroImage: /assets/blog/mi-imagen.jpg  # opcional
category: tips  # noticias | tips | actualizaciones | industria | recetas-exito
tags: ["tag1", "tag2"]
author: "Nombre del Autor"
readingTime: 5  # en minutos
featured: false
---

Contenido en Markdown aquí...
```

### Nueva guía

Crea un archivo `.md` en `src/content/guias/`:

```yaml
---
title: "Título de la guía"
description: "Descripción"
pubDate: 2026-10-01
icon: "🚀"
category: primeros-pasos  # primeros-pasos | facturacion | inventario | mesas | caja | cocina | ia | configuracion
order: 1  # Orden en el listado
difficulty: basico  # basico | intermedio | avanzado
---
```

### Artículo de ayuda

Crea un archivo `.md` en `src/content/ayuda/`:

```yaml
---
title: "¿Cómo hacer X?"
description: "Descripción"
pubDate: 2026-10-01
category: general  # general | facturacion | pagos | impresion | cuenta | tecnico
tags: ["tag1"]
order: 1
---
```

### Entrada de changelog

Crea un archivo `.md` en `src/content/changelog/`:

```yaml
---
title: "SaborAI POS v2.0"
description: "Descripción de la versión"
pubDate: 2026-10-01
version: "v2.0"
type: major  # major | minor | patch
highlights:
  - "Nueva función A"
  - "Mejora B"
---
```

## 🚀 Despliegue en Vercel (blog.saborai.site)

1. Crea un **nuevo proyecto en Vercel** apuntando a la carpeta `blog/`
2. Configura el **Root Directory** como `blog`
3. Agrega el dominio personalizado `blog.saborai.site`
4. En tu proveedor de DNS, agrega un registro CNAME:
   - Nombre: `blog`
   - Valor: `cname.vercel-dns.com`

## 🔧 Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `PUBLIC_GA_ID` | ID de Google Analytics 4 (opcional) |
