---
title: "Facturación Electrónica para Restaurantes en Costa Rica: Todo lo que necesitas saber"
description: "Guía completa sobre facturación electrónica v4.3 de Hacienda para restaurantes en Costa Rica. Aprende los requisitos, cómo funciona con SaborAI POS y evita multas."
pubDate: 2026-09-15
heroImage: /assets/blog/facturacion-electronica-cr.jpg
category: noticias
tags: ["facturación electrónica", "Hacienda", "Costa Rica", "restaurantes", "obligatorio"]
author: "Equipo SaborAI"
readingTime: 10
featured: true
---

La facturación electrónica en Costa Rica es **obligatoria para todos los negocios**, incluyendo restaurantes, sodas y servicios de alimentación. SaborAI POS está certificado para emitir comprobantes electrónicos según las especificaciones más recientes de Hacienda (v4.3).

## ¿Por qué es importante la facturación electrónica?

El Ministerio de Hacienda de Costa Rica requiere que todos los negocios emitan sus facturas en formato electrónico XML. Emitir facturas manuales o en papel (sin el comprobante digital) puede resultar en:

- **Multas** de hasta ₡1,300,000
- **Cierre temporal** del establecimiento
- **Problemas con la declaración de renta**

## ¿Qué incluye la versión 4.3 de Hacienda?

La versión actual del esquema XML de Hacienda incluye mejoras importantes:

1. **Nuevos campos obligatorios** para servicios de restaurante
2. **Validación mejorada** de CABYS (Catálogo de Actividades, Bienes y Servicios)
3. **Soporte para propinas** — Las propinas de servicio ahora tienen un tratamiento fiscal específico
4. **Mejor manejo de descuentos** a nivel de línea y factura total

## Cómo SaborAI POS maneja tu facturación

SaborAI POS integra directamente con Hacienda usando nuestra API certificada:

```
Cliente hace pedido → SaborAI genera XML → 
Firmado digital → Envío a Hacienda → 
Respuesta en segundos → Factura al cliente
```

Todo ocurre en **menos de 5 segundos**, sin que el cliente tenga que esperar.

### Tipos de comprobantes soportados

| Tipo | Código | Cuándo usarlo |
|------|--------|---------------|
| Factura Electrónica | 01 | Clientes con cédula/DIMEX |
| Tiquete Electrónico | 04 | Clientes sin cédula / turistas |
| Nota de Crédito | 03 | Anulaciones parciales |
| Nota de Débito | 02 | Ajustes de más |

## Configuración en SaborAI POS

1. **Obtén tu clave criptográfica** en el portal de Hacienda (ATV)
2. **Sube el archivo .p12** en Configuración → Facturación
3. **Configura tu actividad económica** y código CABYS de restaurante
4. ¡Listo! El sistema emite facturas automáticamente

## Propinas: el detalle que muchos ignoran

Las propinas de servicio (generalmente 10% en Costa Rica) deben declararse correctamente. En SaborAI POS puedes configurar:
- Propina automática 10%
- Propina opcional (el cliente decide)
- Sin propina

Cada configuración genera el tratamiento fiscal correcto en el XML de Hacienda.

## Preguntas frecuentes

**¿Qué pasa si Hacienda está caído?**
SaborAI POS almacena las facturas en modo contingencia y las envía automáticamente cuando el sistema se restablece, dentro del plazo legal de 72 horas.

**¿Puedo emitir facturas en dólares?**
Sí, SaborAI soporta facturación en USD y CRC, con conversión al tipo de cambio del BCCR del día.

---

¿Tienes dudas sobre facturación electrónica? Consulta nuestra [Guía de Facturación](/guias/facturacion-electronica) o visita el [Centro de Ayuda](/ayuda).
