---
title: "Configurar Facturación Electrónica de Hacienda"
description: "Paso a paso para configurar tu certificado de Hacienda y emitir facturas electrónicas válidas en Costa Rica con SaborAI POS."
pubDate: 2026-10-01
icon: "🧾"
category: facturacion
order: 2
difficulty: intermedio
---

# Facturación Electrónica en SaborAI POS

Esta guía te muestra cómo configurar la facturación electrónica v4.3 de Hacienda en SaborAI POS.

## Requisitos previos

Antes de comenzar, necesitas:
- ✅ Cédula jurídica o física activa en Hacienda
- ✅ Usuario y contraseña del ATV (Administración Tributaria Virtual)
- ✅ Archivo de clave criptográfica (.p12)

## Paso 1: Obtener tu clave criptográfica

1. Ingresa a [atv.hacienda.go.cr](https://atv.hacienda.go.cr)
2. Ve a **Facturación Electrónica → Certificados**
3. Genera un nuevo certificado
4. Descarga el archivo **.p12** y guarda bien la contraseña

> **⚠️ Importante:** Guarda una copia del archivo .p12 en un lugar seguro. Si lo pierdes, necesitarás generar uno nuevo.

## Paso 2: Configurar en SaborAI POS

1. Ve a **Configuración → Facturación Electrónica**
2. Sube tu archivo **.p12**
3. Ingresa la contraseña del certificado
4. Completa tu información fiscal:
   - Cédula jurídica / física
   - Nombre o razón social
   - Actividad económica
   - Código CABYS

## Paso 3: Configurar tipos de impuesto

Para restaurantes en Costa Rica:
- **IVA General:** 13% (alimentos procesados en restaurante)
- **IVA Reducido:** 4% (alimentos sin procesar)
- **Exento:** 0% (algunos alimentos básicos)

SaborAI te ayuda a clasificar correctamente cada producto del menú.

## Paso 4: Prueba tu primera factura

1. Crea un pedido de prueba
2. Al cobrar, selecciona **Factura Electrónica**
3. Ingresa la cédula del cliente (o usa la default 106000000 para tiquete)
4. El sistema enviará el XML a Hacienda y recibirás el número de clave en segundos

## Solución de problemas comunes

| Error | Causa | Solución |
|-------|-------|----------|
| "Certificado expirado" | El .p12 venció | Genera uno nuevo en ATV |
| "Contribuyente no inscrito" | Cédula incorrecta | Verifica la cédula del receptor |
| "Timeout Hacienda" | Sistema de Hacienda lento | El sistema reintentará automáticamente |

## Modo contingencia

Si Hacienda no responde, SaborAI guarda las facturas y las envía automáticamente cuando el sistema vuelve, dentro del plazo legal de **72 horas**.

---

¿Problemas con la configuración? Visita nuestro [Centro de Ayuda](/ayuda) o contacta soporte.
