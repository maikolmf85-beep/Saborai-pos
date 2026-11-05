# Guía corta de releases de Saborai POS

Saborai POS usa [Versionado Semántico (SemVer)](https://semver.org/lang/es/): `MAJOR.MINOR.PATCH`.

- **MAJOR**: cambios incompatibles que requieren adaptar datos, integraciones o flujos existentes.
- **MINOR**: funcionalidad nueva compatible con los usos actuales.
- **PATCH**: correcciones compatibles, incluidos arreglos de errores y seguridad.
- **Pre-release**: usa un sufijo como `-rc.1` para candidatas que todavía no son una versión estable.

## Candidata actual

Producción está en `1.0.0`. Esta rama prepara `1.1.0` como candidata por la nueva función compatible de actualización PWA. Sigue siendo solo una candidata local: no se ha publicado ni desplegado.

## Antes de preparar una release

1. Confirma en la plataforma cuál es el commit que está realmente en producción y parte de ese SHA en una rama de trabajo; no uses `main` como base si está atrasada.
2. Revisa los cambios incluidos y clasifícalos para decidir el incremento SemVer. Para esta rama, el incremento MINOR a `1.1.0` corresponde a la función compatible indicada arriba; no asumas versiones para candidatas futuras.
3. Mantén la versión de `package.json` y `package-lock.json` sincronizada y registra los cambios relevantes para la release.
4. Ejecuta las pruebas y la compilación de producción; comprueba la versión y el identificador de build generados.
5. Revisa el diff y comunica el SHA base, la versión propuesta y los resultados. No hagas push, merge ni despliegue hasta recibir aprobación explícita.
