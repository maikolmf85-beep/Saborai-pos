---
title: "¿Qué hacer cuando Hacienda rechaza una factura?"
description: "Guía para interpretar y resolver los errores más comunes al emitir facturas electrónicas en Costa Rica con SaborAI POS."
pubDate: 2026-10-01
category: facturacion
tags: ["facturación electrónica", "Hacienda", "error", "rechazo", "Costa Rica"]
order: 2
---

# Errores de Hacienda: Causas y Soluciones

Cuando Hacienda rechaza una factura electrónica, SaborAI te muestra el código de error y una descripción. Aquí explicamos los más comunes.

## Error: "Emisor no está inscrito como contribuyente"

**Causa:** Tu cédula no está activa en el registro de contribuyentes de Hacienda.

**Solución:**
1. Verifica en [ATV de Hacienda](https://atv.hacienda.go.cr) que tu cédula esté activa
2. Si no está inscrita, regístrate como contribuyente
3. Una vez activa, las facturas se procesarán normalmente

## Error: "Receptor no válido"

**Causa:** La cédula del cliente no existe o tiene un formato incorrecto.

**Solución:**
- Si el cliente no tiene cédula (turista extranjero): usa la cédula **106000000** para emitir un Tiquete Electrónico
- Si es costarricense: verifica el número de cédula (9 dígitos sin guiones)
- Si es empresa: verifica la cédula jurídica (10 dígitos)

## Error: "Código CABYS no válido"

**Causa:** El código CABYS asignado a un producto no coincide con lo que vende.

**Solución:**
1. Ve a **Menú → Producto → Editar**
2. Actualiza el código CABYS correcto
3. Para restaurantes: usa el catálogo oficial de CABYS de Hacienda

## Error: "Certificado expirado"

**Causa:** Tu archivo .p12 de Hacienda venció (duran 2 años).

**Solución:**
1. Ingresa a [atv.hacienda.go.cr](https://atv.hacienda.go.cr)
2. Genera un nuevo certificado
3. Descarga el nuevo .p12
4. Súbelo en **Configuración → Facturación → Certificado**

## ¿Qué pasa con las facturas rechazadas?

Las facturas rechazadas por Hacienda **no son válidas** para el cliente. Debes:
1. Corregir el error
2. Emitir una nueva factura

SaborAI guarda el historial de facturas rechazadas en **Reportes → Facturas → Rechazadas**.

---

¿El error no está en esta lista? Escríbenos al soporte con el código de error exacto.
