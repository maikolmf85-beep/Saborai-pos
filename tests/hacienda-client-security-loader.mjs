const sourceRoot = new URL('../src/', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!context.parentURL?.startsWith(sourceRoot) || !specifier.startsWith('.')) throw error;
    const candidates = error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
      ? [`${specifier}/index.ts`, `${specifier}/index.js`]
      : error?.code === 'ERR_MODULE_NOT_FOUND' && !/\.[a-z0-9]+$/i.test(specifier)
        ? [`${specifier}.ts`, `${specifier}/index.ts`]
        : [];
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {}
    }
    throw error;
  }
}
